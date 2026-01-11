import "@testing-library/jest-dom";

// Mock scrollIntoView which is not available in jsdom
Element.prototype.scrollIntoView = () => {};

// Mock ResizeObserver which is not available in jsdom
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};
