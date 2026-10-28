import { paintInfo } from "../paint/eleventy.js";

export default {
  layout: "post.njk",
  // `permalink: false` means a draft is never written to the site.
  permalink: (data) => (data.draft === true ? false : `/notes/${data.page.fileSlug}/`),
  eleventyComputed: {
    // Resolved paint (colours, shape, image URLs) from the note's `paint:` front matter.
    paintInfo,
  },
};
