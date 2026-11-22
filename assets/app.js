import { createSearch, getContext, makeSnippet, parseUrlState, toUrlState } from "./lib/search-core.js?v=20261122g";
import { formatTimestamp, parseHash, renderContext, renderResult } from "./lib/dom.js?v=20261122g";

const $ = (id) => document.getElementById(id);

const els = {
  form: $("search-form"),
  q: $("search-input"),
  author: $("author"),
  from: $("from"),
  to: $("to"),
  sort: $("sort"),
  has: $("has"),
  clear: $("clear"),
  refresh: $("refresh"),
  refreshed: $("refreshed"),
  snapshot: $("snapshot-info"),
  count: $("result-count"),
  list: $("results-list"),
  more: $("load-more"),
  error: $("error"),
};

let snapshot = null;
let search = null;
let debounce = null;

function controlsToState() {
  return {
    q: els.q.value.trim(),
    authorKey: els.author.value,
    from: els.from.value,
    to: els.to.value,
    sort: els.sort.value,
    has: els.has.value,
  };
}

function stateToControls(state) {
  els.q.value = state.q;
  els.author.value = state.authorKey;
  els.from.value = state.from;
  els.to.value = state.to;
  els.sort.value = state.sort;
  els.has.value = state.has;
}

function syncUrl() {
  const query = toUrlState(controlsToState());
  history.replaceState(null, "", `${location.pathname}${query}${location.hash}`);
}

function fillAuthors() {
  const selected = els.author.value;
  const options = [new Option("Anyone", "")];
  for (const author of search.authors()) {
    options.push(new Option(`${author.name} (${author.count})`, author.key));
  }
  els.author.replaceChildren(...options);
  els.author.value = options.some((option) => option.value === selected) ? selected : "";
}

function messageSummary(data) {
  const authors = new Set(data.messages.map((m) => m.authorKey)).size;
  return `${data.messages.length} messages · ${authors} authors · snapshot ${formatTimestamp(data.scrapedAt)}`;
}

function showError(message) {
  els.error.textContent = message;
  els.error.hidden = false;
}

function copyLink(message, button) {
  const url = new URL(location.href);
  url.hash = `m=${message.id}`;
  const done = () => {
    const label = button.textContent;
    button.textContent = "Copied";
    setTimeout(() => {
      button.textContent = label;
    }, 1500);
  };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(url.toString()).then(done, () => showError("Could not copy the link."));
  } else {
    showError("Clipboard is not available in this browser.");
  }
}

function toggleContext(message, card, button) {
  const existing = card.querySelector(".context");
  if (existing) {
    existing.remove();
    button.textContent = "Show context";
    return;
  }
  card.append(renderContext(getContext(snapshot.messages, message.id), message.id));
  button.textContent = "Hide context";
}

const handlers = { onCopy: copyLink, onContext: toggleContext };

function render() {
  if (!search) return;
  const state = controlsToState();
  const { results, total } = search.run({ ...state });

  els.list.replaceChildren();
  for (const result of results) els.list.append(renderResult(result, handlers));

  if (total === 0) {
    els.count.textContent = state.q
      ? "No messages match that search."
      : "No messages match those filters.";
  } else {
    const shown = results.length;
    const label = state.q ? "matches" : "messages";
    els.count.textContent =
      shown < total ? `${total} ${label} · showing ${shown}` : `${total} ${label}`;
  }

  els.more.hidden = true;
}

function applyData(data) {
  snapshot = data;
  search = createSearch(data.messages);
  els.snapshot.textContent = messageSummary(data);
  fillAuthors();
  stateToControls(parseUrlState(location.search));
  render();
  focusHash();
}

function focusHash() {
  const id = parseHash(location.hash);
  if (!id) return;
  const message = search?.messagesById.get(id);
  if (!message) return;

  let card = [...els.list.querySelectorAll(".result")].find((node) => node.dataset.messageId === id);
  if (!card) {
    card = renderResult(
      { message, snippet: makeSnippet(message.content, "") },
      handlers,
    );
    card.classList.add("result-linked");
    els.list.prepend(card);
  }
  card.scrollIntoView({ block: "center" });
  card.classList.add("result-linked");
  setTimeout(() => card.classList.remove("result-linked"), 2000);
}

async function refresh() {
  els.refresh.disabled = true;
  els.refreshed.textContent = "Checking for a newer snapshot…";
  try {
    const response = await fetch(`data/messages.json?ts=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data?.messages) || data.messages.length === 0) {
      throw new Error("snapshot has no messages");
    }
    if (snapshot && data.scrapedAt === snapshot.scrapedAt) {
      els.refreshed.textContent = "Already up to date.";
      return;
    }
    applyData(data);
    els.refreshed.textContent = `Updated to ${formatTimestamp(data.scrapedAt)}.`;
  } catch (error) {
    els.refreshed.textContent = `Refresh failed: ${error.message}`;
  } finally {
    els.refresh.disabled = false;
  }
}

function scheduleRender() {
  clearTimeout(debounce);
  debounce = setTimeout(() => {
      syncUrl();
    render();
  }, 80);
}

els.form.addEventListener("input", scheduleRender);
els.form.addEventListener("change", scheduleRender);
els.form.addEventListener("submit", (event) => {
  event.preventDefault();
  els.list.querySelector(".result a")?.click();
});

els.clear.addEventListener("click", () => {
  els.form.reset();
  els.sort.value = "relevance";
  syncUrl();
  render();
  els.q.focus();
});

els.refresh.addEventListener("click", refresh);

els.more.addEventListener("click", render);

window.addEventListener("hashchange", focusHash);

document.addEventListener("keydown", (event) => {
  const tag = event.target?.tagName;
  const typing = tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA";
  if (event.key === "/" && !typing) {
    event.preventDefault();
    els.q.focus();
  } else if (event.key === "Escape" && event.target === els.q) {
    els.q.value = "";
    scheduleRender();
  }
});

fetch(`data/messages.json?ts=${Date.now()}`, { cache: "no-store" })
  .then((response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  })
  .then(applyData)
  .catch((error) => {
    els.snapshot.textContent = "Snapshot unavailable";
    showError(`Could not load data/messages.json: ${error.message}`);
  });
