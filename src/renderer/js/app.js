import { AppController, ModalManager, ScreenManager, ToastManager } from "../systems/index.js";

console.info("[Renderer] boot start");

window.addEventListener("error", (event) => {
  console.error("[Renderer] window error", {
    message: event?.message,
    source: event?.filename,
    lineno: event?.lineno,
    colno: event?.colno,
    stack: event?.error?.stack
  });
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event?.reason;
  const error = reason instanceof Error ? reason : new Error(String(reason));
  console.error("[Renderer] unhandledrejection", {
    message: error?.message,
    stack: error?.stack
  });
});

const appNode = document.getElementById("app");
const modalNode = document.getElementById("modal-root");
const toastNode = document.getElementById("toast-root");

console.info("[Renderer] root nodes", {
  hasAppNode: Boolean(appNode),
  hasModalNode: Boolean(modalNode),
  hasToastNode: Boolean(toastNode)
});

const screenManager = new ScreenManager(appNode);
const modalManager = new ModalManager(modalNode);
const toastManager = new ToastManager(toastNode);
const appController = new AppController({ screenManager, modalManager, toastManager });

console.info("[Renderer] AppController.init() starting");
appController.init();
