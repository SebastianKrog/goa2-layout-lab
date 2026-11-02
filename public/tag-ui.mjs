import { tagLabel, tagType } from "./tags.mjs";
const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};
const button = (text, action) => {
  const node = el("button", "", text);
  node.type = "button";
  node.onclick = action;
  return node;
};
const tagHosts = new Set();
let tagFrame;
const tagObserver = new ResizeObserver((entries) => {
  for (const { target, contentRect } of entries) {
    if (target.dataset.width === String(contentRect.width)) continue;
    target.dataset.width = String(contentRect.width);
    fitTags(target);
  }
});
function fitTags(host) {
  const chips = [...host.querySelectorAll(".tag-chip")],
    more = host.querySelector(".tag-more");
  if (!host.clientWidth || !chips.length) return;
  chips.forEach((chip) => (chip.hidden = false));
  more.hidden = true;
  if (host.classList.contains("expanded-tags")) {
    more.hidden = false;
    more.textContent = "−";
    more.title = "Show fewer tags";
    more.setAttribute("aria-label", "Show fewer tags");
    return;
  }
  const gap = parseFloat(getComputedStyle(host).columnGap) || 0;
  const widths = chips.map((chip) => chip.getBoundingClientRect().width);
  if (
    widths.reduce((sum, width) => sum + width, 0) + gap * (chips.length - 1) <=
    host.clientWidth
  )
    return;
  more.hidden = false;
  let visible = chips.length;
  do {
    visible--;
    more.textContent = "+" + (chips.length - visible);
  } while (
    visible > 0 &&
    widths.slice(0, visible).reduce((sum, width) => sum + width + gap, 0) +
      more.getBoundingClientRect().width >
      host.clientWidth
  );
  chips.forEach((chip, index) => (chip.hidden = index >= visible));
  more.title = chips
    .slice(visible)
    .map((chip) => chip.title)
    .join(", ");
  more.setAttribute(
    "aria-label",
    "Show " + (chips.length - visible) + " more tags",
  );
}
export function tagList(tags, select) {
  const host = el("span", "tag-list");
  host.title = tags.join(", ");
  for (const tag of tags) {
    const chip = select
      ? button(tagLabel(tag), () => select(tag))
      : el("span", "tag-chip", tagLabel(tag));
    chip.className = "tag-chip";
    chip.dataset.tagType = tagType(tag);
    chip.title = tag;
    if (select) chip.setAttribute("aria-label", "Filter by tag " + tag);
    host.append(chip);
  }
  if (tags.length) {
    const more = button("", () => {
      host.classList.toggle("expanded-tags");
      fitTags(host);
    });
    more.className = "tag-more";
    more.hidden = true;
    host.append(more);
    tagHosts.add(host);
    tagObserver.observe(host);
    cancelAnimationFrame(tagFrame);
    tagFrame = requestAnimationFrame(() => {
      for (const item of tagHosts) {
        if (!item.isConnected) {
          tagObserver.unobserve(item);
          tagHosts.delete(item);
        } else fitTags(item);
      }
    });
  }
  return host;
}

export function observeTagLists(root) {
  for (const host of tagHosts)
    if (!host.isConnected) {
      tagObserver.unobserve(host);
      tagHosts.delete(host);
    }
  for (const host of root.querySelectorAll(".tag-list")) {
    tagHosts.add(host);
    const more = host.querySelector(".tag-more");
    if (more)
      more.onclick = () => {
        host.classList.toggle("expanded-tags");
        fitTags(host);
      };
    tagObserver.observe(host);
    fitTags(host);
  }
}
