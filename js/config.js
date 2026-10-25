// Deployment settings for the exhibit.
//
// share: where visitors may send a recorded training session (they choose "Record and share" on the consent
// screen, or send it from the result screen). Leave url empty to keep everything local (sessions can still be
// downloaded). Point it at the session collector once it is deployed (hf/worker, free; or hf/space on a paid
// Hugging Face plan), e.g.
//   url: 'https://fib-view-collector.<subdomain>.workers.dev/submit', dataset: 'rmsreis/fib-view-training'
// support: the "Buy me a coffee" and "Subscribe for news" buttons at the top left. coffee is a full
// https://buymeacoffee.com/<name> address (the button stays hidden while it is empty); subscribe is the collector's
// /subscribe endpoint (shared with TEM-view: one mailing list for the exhibits); empty hides the form.
export const SUPPORT = {
  coffee: 'https://buymeacoffee.com/rmsreis',
  newsletter: '',
  subscribe: 'https://tem-view-collector.tem-view.workers.dev/subscribe',
  repo: 'https://github.com/Advanced-EM/FIB-view',
};

// agent: the local fibview-mcp server (tools/fibview-mcp) an AI agent runs; the exhibit connects only when the
// visitor clicks "Connect agent". It tries each address in turn: 8792 is fibview-mcp's default (TEM-view's
// temview-mcp uses 8790), 8793 a common choice when 8792 is taken.
export const AGENT = { urls: ['ws://127.0.0.1:8792', 'ws://127.0.0.1:8793'] };

export const SHARE = {
  url: 'https://fib-view-collector.tem-view.workers.dev/submit',
  dataset: 'rmsreis/fib-view-training',
};
