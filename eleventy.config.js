import { feedPlugin } from "@11ty/eleventy-plugin-rss";
import site from "./_data/site.js";
import tagDefinitions from "./_data/tagDefinitions.js";
import paintPlugin from "./paint/eleventy.js";
import { layoutBoard, boardHeight } from "./paint/board.js";


// Turns a free-text tag like "AI in the studio" into "ai-in-the-studio".
export function slugify(text) {
  return String(text)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Front matter dates like `2026-09-28` are parsed as UTC midnight, so format in UTC
// to avoid showing the previous day.
function formatDate(date, options) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...options }).format(date);
}

function validateNote(note) {
  const { title, type, tags = [] } = note.data;
  const problems = [];
  if (typeof title !== "string" || !title.trim()) problems.push("`title` is required");
  if (type !== undefined && !site.types.includes(type)) problems.push(`\`type\` must be one of: ${site.types.join(", ")}`);
  for (const tag of tags) {
    if (!slugify(tag)) problems.push(`tag "${tag}" has no letters or digits to build a URL from`);
  }
  if (problems.length) throw new Error(`${note.inputPath}: ${problems.join("; ")}`);
}

// Notes live in notes/, notes/pinned/ and notes/ideating/ (any depth below those).
// Each call returns a fresh array, so no template can reorder another's list.
function getNotes(collectionApi) {
  // Drafts (`draft: true`) are left out of every collection; notes.11tydata.js stops them being written.
  const notes = collectionApi
    .getFilteredByGlob("./notes/**/*.md")
    .filter((note) => note.data.draft !== true)
    .sort(byOrderThenTitle);
  notes.forEach(validateNote);
  return notes;
}

const inFolder = (folder) => (note) => note.inputPath.startsWith(`./notes/${folder}/`);

// Definitions keyed by slug, so "AI in the studio" and "AI in the Studio" match.
const definitionsBySlug = new Map(
  Object.entries(tagDefinitions).map(([name, definition]) => [slugify(name), definition]),
);
const tagDefinition = (tag) => definitionsBySlug.get(slugify(tag)) || "";

// Living documents have no natural date order: sort by optional `order`, then title.
function byOrderThenTitle(a, b) {
  const orderA = a.data.order ?? Infinity;
  const orderB = b.data.order ?? Infinity;
  if (orderA !== orderB) return orderA < orderB ? -1 : 1;
  return a.data.title.localeCompare(b.data.title);
}

export default function (eleventyConfig) {
  eleventyConfig.ignores.add("README.md");
  eleventyConfig.ignores.add("paint/NOTES.md");
  eleventyConfig.ignores.add("deploy/**");
  eleventyConfig.ignores.add("archive/**");
  eleventyConfig.addPassthroughCopy("css");
  eleventyConfig.addPassthroughCopy("images");
  eleventyConfig.addPlugin(paintPlugin);

  eleventyConfig.addFilter("readableDate", (date) =>
    formatDate(date, { day: "numeric", month: "long", year: "numeric" }),
  );
  eleventyConfig.addFilter("isoDate", (date) => date.toISOString().slice(0, 10));
  eleventyConfig.addFilter("tagUrl", (tag) => `/tags/${slugify(tag)}/`);
  eleventyConfig.addFilter("tagDefinition", tagDefinition);

  eleventyConfig.addCollection("notes", getNotes);
  eleventyConfig.addCollection("pinnedNotes", (api) => getNotes(api).filter(inFolder("pinned")));
  eleventyConfig.addCollection("ideatingNotes", (api) => getNotes(api).filter(inFolder("ideating")));
  eleventyConfig.addCollection("otherNotes", (api) =>
    getNotes(api).filter((note) => !inFolder("pinned")(note) && !inFolder("ideating")(note)),
  );

  // One entry per tag: [{ name, slug, definition, notes }], alphabetical.
  // Every published note except ideating ones, laid out as tiles on the homepage canvas.
  eleventyConfig.addCollection("board", (api) =>
    layoutBoard(
      getNotes(api)
        .filter((note) => !inFolder("ideating")(note) && note.data.paintInfo)
        .map((note) => ({
          key: note.data.paintInfo.slug,
          note,
          place: note.data.place,
          ratio: note.data.paintInfo.ratio,
          words: note.data.paintInfo.words,
        })),
    ),
  );
  eleventyConfig.addFilter("boardHeight", boardHeight);
  // Thumbnail size (px) for a tile of height ÷ width `ratio`, all with the same area.
  eleventyConfig.addFilter("thumbSize", (ratio, area = 72 * 72) => {
    const w = Math.sqrt(area / ratio);
    return { w: Math.round(w), h: Math.round(w * ratio) };
  });
  eleventyConfig.addFilter("maxTileWidth", (tiles) => Math.max(1, ...tiles.map((t) => t.w)));
  // Drafts included: the studio can paint a note before it's published.
  eleventyConfig.addCollection("studioNotes", (api) =>
    api.getFilteredByGlob("./notes/**/*.md").sort(byOrderThenTitle),
  );
  eleventyConfig.addFilter("studioData", (notes) =>
    notes
      .filter((note) => note.data.paintInfo)
      .map((note) => {
        const { jobs, ...info } = note.data.paintInfo;
        return { title: note.data.title, url: note.url, draft: note.data.draft === true, ...info };
      }),
  );
  // JSON safe to drop inside a <script> element.
  eleventyConfig.addFilter("scriptJson", (value) => JSON.stringify(value).replace(/</g, "\\u003c"));

  eleventyConfig.addCollection("tagList", (api) => {
    const bySlug = new Map();
    for (const note of getNotes(api)) {
      for (const name of note.data.tags || []) {
        const slug = slugify(name);
        const entry = bySlug.get(slug);
        if (entry && entry.name !== name) {
          throw new Error(
            `Tags "${entry.name}" and "${name}" (in ${note.inputPath}) both map to /tags/${slug}/. Use one spelling.`,
          );
        }
        if (!entry) bySlug.set(slug, { name, slug, definition: tagDefinition(name), notes: [note] });
        else entry.notes.push(note);
      }
    }
    return [...bySlug.values()].sort((a, b) => a.name.localeCompare(b.name));
  });

  if (site.feed) eleventyConfig.addPlugin(feedPlugin, {
    type: "rss",
    outputPath: "/feed.xml",
    collection: { name: "notes", limit: 20 },
    metadata: {
      language: site.language,
      title: site.title,
      subtitle: site.tagline,
      base: `${site.url}/`,
      author: { name: site.author },
    },
  });
}

export const config = {
  // Posts are plain Markdown: don't run them through a template language first.
  markdownTemplateEngine: false,
};
