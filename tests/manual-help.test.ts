import assert from 'node:assert/strict';
import { after, afterEach, test } from 'node:test';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost:3000',
  pretendToBeVisual: true,
});
const browser = dom.window;
for (const key of ['window', 'Window', 'document', 'Document', 'navigator', 'HTMLElement', 'Element', 'Node', 'MutationObserver', 'DOMRect', 'Range'] as const) {
  const value = key === 'window' ? browser : browser[key as keyof typeof browser];
  Object.defineProperty(globalThis, key, { configurable: true, value });
}
Object.defineProperty(globalThis, 'getComputedStyle', { configurable: true, value: browser.getComputedStyle.bind(browser) });
Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: browser.requestAnimationFrame.bind(browser) });
Object.defineProperty(globalThis, 'cancelAnimationFrame', { configurable: true, value: browser.cancelAnimationFrame.bind(browser) });
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true, writable: true });
browser.HTMLElement.prototype.scrollTo = function () {};
browser.Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
browser.Range.prototype.getBoundingClientRect = () => new browser.DOMRect();
class TestResizeObserver { observe() {} unobserve() {} disconnect() {} }
Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: TestResizeObserver });
Object.defineProperty(browser, 'ResizeObserver', { configurable: true, value: TestResizeObserver });

const React: typeof import('react') = require('react');
const { render, fireEvent, screen, waitFor, cleanup }: typeof import('@testing-library/react') = require('@testing-library/react');
const { default: Workspace }: typeof import('../src/components/workspace') = require('../src/components/workspace');
const { createSession, SESSION_KEY }: typeof import('../src/lib/session') = require('../src/lib/session');

const broken = "print('hello'";
const corrected = "print('hello')";
let configured = true;
let executions: Array<{ code: string; stdin: string; language: string }> = [];
let aiRequests: Array<Record<string, unknown>> = [];
const originalFetch = globalThis.fetch;
const originalWorker = globalThis.Worker;

class TestWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminated = false;
  postMessage(input: { code: string; stdin: string; language: string }) {
    executions.push(input);
    queueMicrotask(() => {
      if (this.terminated) return;
      const success = input.code === corrected;
      this.onmessage?.({ data: { type: 'status', phase: 'running', status: 'Running…' } });
      this.onmessage?.({ data: { type: 'output', stream: success ? 'stdout' : 'stderr', text: success ? 'hello\n' : "SyntaxError: '(' was never closed\n" } });
      this.onmessage?.({ data: { type: 'done', exitCode: success ? 0 : 1 } });
    });
  }
  terminate() { this.terminated = true; }
}

function setup(serverConfigured = true) {
  configured = serverConfigured;
  executions = [];
  aiRequests = [];
  browser.localStorage.clear();
  const session = createSession();
  session.files.python = { code: broken, stdin: '41' };
  // Existing users previously had this setting enabled. It must not trigger AI.
  browser.localStorage.setItem(SESSION_KEY, JSON.stringify({ ...session, autoFix: true }));
  globalThis.Worker = TestWorker as unknown as typeof Worker;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(input), '/api/ai');
    if (!init?.method || init.method === 'GET') return Response.json({ configured, model: 'test-model' });
    aiRequests.push(JSON.parse(String(init.body)));
    return Response.json({ explanation: 'Add the missing closing parenthesis.', code: corrected, changes: ['Added a closing parenthesis.'] });
  }) as typeof fetch;
  return render(React.createElement(Workspace));
}

async function runFailedProgram() {
  await waitFor(() => assert.equal((screen.getByRole('button', { name: /Run code/ }) as HTMLButtonElement).disabled, false));
  fireEvent.click(screen.getByRole('button', { name: /Run code/ }));
  await screen.findByRole('button', { name: 'Help me fix this error' });
  await waitFor(() => assert.equal(document.querySelector('.cm-content')?.textContent, broken));
}

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  globalThis.Worker = originalWorker;
});
after(() => dom.window.close());

test('a failed run waits for Help, Apply, and Run as three separate user actions', async () => {
  setup();
  await runFailedProgram();
  assert.equal(aiRequests.length, 0, 'Run must never request an automatic AI repair');
  assert.equal(executions.length, 1, 'A failed program must execute only once');
  assert.equal(screen.queryByRole('switch', { name: 'Automatically fix errors' }), null);

  // Help must describe the failed run, even if its input is edited afterward.
  fireEvent.click(screen.getByRole('tab', { name: 'Input' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Program input' }), { target: { value: '99' } });
  fireEvent.click(screen.getByRole('tab', { name: 'Output' }));
  fireEvent.click(screen.getByRole('button', { name: 'Help me fix this error' }));
  const apply = await screen.findByRole('button', { name: 'Apply to editor' });
  assert.equal(aiRequests.length, 1);
  assert.equal(aiRequests[0].action, 'fix');
  assert.equal(aiRequests[0].code, broken);
  assert.equal(aiRequests[0].stdin, '41', 'Use original failed-run input, not later edits');
  assert.match(String(aiRequests[0].error), /SyntaxError/);
  assert.equal(document.querySelector('.cm-content')?.textContent, broken, 'AI reply must leave the editor unchanged');
  assert.equal(executions.length, 1, 'Receiving AI advice must not rerun code');

  fireEvent.click(apply);
  await waitFor(() => assert.equal(document.querySelector('.cm-content')?.textContent, corrected));
  assert.equal(executions.length, 1, 'Applying a suggestion must not execute it');
  fireEvent.click(screen.getByRole('button', { name: /Run code/ }));
  await screen.findByText('hello', { selector: '.stdout' });
  assert.equal(executions.length, 2);
  assert.equal(executions[1].code, corrected);
  assert.equal(executions[1].stdin, '99');
  assert.equal(aiRequests.length, 1);
});

test('connecting AI after an error does not silently start a repair request', async () => {
  setup(false);
  await runFailedProgram();
  fireEvent.click(screen.getByRole('button', { name: 'Help me fix this error' }));
  const key = await screen.findByLabelText('Groq API key');
  fireEvent.change(key, { target: { value: 'gsk_test' } });
  fireEvent.click(screen.getByRole('button', { name: 'Connect Groq' }));
  await waitFor(() => assert.equal(screen.queryByRole('dialog'), null));
  assert.equal(aiRequests.length, 0);
  assert.equal(executions.length, 1);
  assert.equal(document.querySelector('.cm-content')?.textContent, broken);
  fireEvent.click(screen.getByRole('button', { name: 'Help me fix this error' }));
  await screen.findByRole('button', { name: 'Apply to editor' });
  assert.equal(aiRequests.length, 1);
  assert.equal(executions.length, 1);
});
