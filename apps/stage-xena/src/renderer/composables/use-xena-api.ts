/**
 * Typed access to the preload-exposed API.
 */
import type { XenaApi } from "../../preload/index.js";

declare global {
  interface Window {
    xena: XenaApi;
  }
}

export const xena = window.xena;
