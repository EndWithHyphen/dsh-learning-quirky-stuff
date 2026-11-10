import React from 'react';
import { createRoot } from 'react-dom/client';
import { apply } from '../../src/client.jsx';
window.EXCALIDRAW_ASSET_PATH = location.origin + '/assets/';
const dictionary = {};
const rpc =
  (method) =>
  async (...args) =>
    (
      await fetch('/qa-api', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method, args }),
      })
    ).json();
const context = {
  effect: (fn) => fn(),
  locale: {
    register: (_name, words) => Object.assign(dictionary, words.zh),
    bind: () => (key) => dictionary[key] || key,
  },
  remote: {
    $mount: async () => {},
    studyboard: Object.fromEntries(
      ['execute', 'models', 'captureInfo', 'capturePairing'].map((method) => [method, rpc(method)]),
    ),
  },
  inject: (_dependencies, fn) => fn(context),
  slots: {
    inject: (_name, fn) => fn(),
    register: (options, Component) => {
      if (options.name === 'main') createRoot(document.getElementById('root')).render(<Component />);
    },
  },
};
apply(context);
