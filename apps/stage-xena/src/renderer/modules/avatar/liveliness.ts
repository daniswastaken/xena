/**
 * Liveliness: procedural micro-animation on the avatar sprite.
 * Idle breathing + talking bounce, pure CSS transforms (compositor-only,
 * no layout/paint) — cheap enough for the weak target machine.
 * Real Live2D would replace this; until then the PNGtuber breathes.
 */
export class Liveliness {
  private frame: number | null = null;
  private readonly img: HTMLImageElement | null;

  constructor(private readonly talking: () => boolean) {
    this.img = document.getElementById("avatar") as HTMLImageElement | null;
  }

  start(): void {
    if (this.frame !== null || !this.img) return;
    const loop = (t: number): void => {
      const seconds = t / 1000;
      if (this.talking()) {
        // bounce at ~5 Hz, subtle
        const bounce = Math.abs(Math.sin(seconds * Math.PI * 5));
        const scaleY = 1 + bounce * 0.035;
        const scaleX = 1 - bounce * 0.018;
        this.img!.style.transform = `scale(${scaleX}, ${scaleY})`;
      } else {
        // breathing ~0.28 Hz + faint sway
        const breath = (Math.sin(seconds * Math.PI * 2 * 0.28) + 1) / 2;
        const scaleY = 1 + breath * 0.012;
        const tilt = Math.sin(seconds * Math.PI * 2 * 0.11) * 0.7;
        this.img!.style.transform = `rotate(${tilt}deg) scale(1, ${scaleY})`;
      }
      this.frame = requestAnimationFrame(loop);
    };
    this.frame = requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    if (this.img) this.img.style.transform = "";
  }
}
