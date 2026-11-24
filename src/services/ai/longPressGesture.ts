/**
 * Mobile Long-Press Gesture Controller
 * Distinguishes an intentional long press (default 450ms) from a normal tap or scroll gesture.
 * Pure TypeScript so gesture timing & scroll-cancellation logic can be tested deterministically.
 */

export const DEFAULT_LONG_PRESS_DELAY_MS = 450;
export const LONG_PRESS_MOVE_THRESHOLD_PX = 8;

export interface LongPressControllerOptions {
  delayMs?: number;
  moveThresholdPx?: number;
  onLongPress: () => void;
}

export class LongPressController {
  private readonly delayMs: number;
  private readonly moveThresholdPx: number;
  private readonly onLongPress: () => void;
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private startX = 0;
  private startY = 0;
  private active = false;
  private triggered = false;

  constructor(options: LongPressControllerOptions) {
    this.delayMs = options.delayMs ?? DEFAULT_LONG_PRESS_DELAY_MS;
    this.moveThresholdPx = options.moveThresholdPx ?? LONG_PRESS_MOVE_THRESHOLD_PX;
    this.onLongPress = options.onLongPress;
  }

  start(clientX: number, clientY: number): void {
    this.clearTimer();
    this.active = true;
    this.triggered = false;
    this.startX = clientX;
    this.startY = clientY;

    this.timerId = setTimeout(() => {
      if (!this.active) return;
      this.active = false;
      this.triggered = true;
      this.timerId = null;
      this.onLongPress();
    }, this.delayMs);
  }

  move(clientX: number, clientY: number): void {
    if (!this.active) return;
    const dx = Math.abs(clientX - this.startX);
    const dy = Math.abs(clientY - this.startY);
    if (dx > this.moveThresholdPx || dy > this.moveThresholdPx) {
      this.cancel();
    }
  }

  /**
   * Ends the touch sequence. Returns true if long-press already fired
   * (so normal tap click navigation must be suppressed).
   */
  end(): boolean {
    const didTrigger = this.triggered;
    this.clearTimer();
    this.active = false;
    return didTrigger;
  }

  cancel(): void {
    this.clearTimer();
    this.active = false;
    this.triggered = false;
  }

  consumeTriggeredClick(): boolean {
    if (!this.triggered) return false;
    this.triggered = false;
    return true;
  }

  isLongPressActive(): boolean {
    return this.active || this.triggered;
  }

  private clearTimer(): void {
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }
}
