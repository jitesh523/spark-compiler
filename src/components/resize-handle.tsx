'use client';

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';

type ResizeHandleProps = {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  containerRef: RefObject<HTMLElement | null>;
  label: string;
  onReset: () => void;
};

type DragState = {
  pointerId: number;
  body: HTMLElement;
  userSelect: string;
  cursor: string;
};

export function ResizeHandle({ value, min, max, onChange, containerRef, label, onReset }: ResizeHandleProps) {
  const handleRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [dragging, setDragging] = useState(false);

  function restoreSelection() {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    drag.body.style.userSelect = drag.userSelect;
    drag.body.style.cursor = drag.cursor;
    const handle = handleRef.current;
    if (handle?.hasPointerCapture(drag.pointerId)) {
      handle.releasePointerCapture(drag.pointerId);
    }
  }

  useEffect(() => () => {
    // A layout change can remove the divider in the middle of a drag.
    const drag = dragRef.current;
    if (drag) {
      drag.body.style.userSelect = drag.userSelect;
      drag.body.style.cursor = drag.cursor;
      dragRef.current = null;
    }
  }, []);

  function resizeAt(clientX: number) {
    const bounds = containerRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width === 0) return;
    const percent = ((clientX - bounds.left) / bounds.width) * 100;
    onChange(Math.min(max, Math.max(min, percent)));
  }

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || event.button !== 0 || dragRef.current) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    const body = event.currentTarget.ownerDocument.body;
    dragRef.current = {
      pointerId: event.pointerId,
      body,
      userSelect: body.style.userSelect,
      cursor: body.style.cursor,
    };
    body.style.userSelect = 'none';
    body.style.cursor = 'col-resize';
    setDragging(true);
    resizeAt(event.clientX);
  }

  function finishDrag(event: PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    restoreSelection();
    setDragging(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    let next: number;
    switch (event.key) {
      case 'ArrowLeft': next = value - 2; break;
      case 'ArrowRight': next = value + 2; break;
      case 'Home': next = min; break;
      case 'End': next = max; break;
      case 'Enter':
        event.preventDefault();
        onReset();
        return;
      default: return;
    }
    event.preventDefault();
    onChange(Math.min(max, Math.max(min, next)));
  }

  return (
    <div
      ref={handleRef}
      className="workspace-resize-handle"
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={`${Math.round(value)}% editor width`}
      title="Drag to resize · Arrow keys to adjust · Double-click to reset"
      data-dragging={dragging || undefined}
      style={{ touchAction: 'none' }}
      onPointerDown={startDrag}
      onPointerMove={(event) => {
        if (dragRef.current?.pointerId === event.pointerId) resizeAt(event.clientX);
      }}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onLostPointerCapture={finishDrag}
      onKeyDown={handleKeyDown}
      onDoubleClick={onReset}
    >
      <span aria-hidden="true" />
    </div>
  );
}
