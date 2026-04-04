import type { BrowserVendorName } from "../core/types.js";

export interface BrowserSessionDefinition {
  baseUrl: string;
  isAuthenticated: (url: string, text: string) => boolean;
}

export const browserSessionDefinitions: Record<BrowserVendorName, BrowserSessionDefinition> = {
  xometry: {
    baseUrl: "https://www.xometry.com/quoting/home/",
    isAuthenticated: (url, text) =>
      !/Upload a 3D model to see instant pricing/i.test(text) &&
      !/sign in|sign up|create account|email/i.test(text) &&
      !/login/i.test(url),
  },
  rapiddirect: {
    baseUrl: "https://app.rapiddirect.com/",
    isAuthenticated: (_url, text) =>
      !/Log in to your account/i.test(text) &&
      !(/Email address/i.test(text) &&
        /Password/i.test(text) &&
        /Don't have an account\?\s*Sign Up/i.test(text)),
  },
  protolabs: {
    baseUrl: "https://buildit.protolabs.com/?lang=en-US&getaquote=true",
    isAuthenticated: (url, text) =>
      !/identity\.protolabs\.com/i.test(url) &&
      !/sign in|sign up|create account/i.test(text),
  },
};
