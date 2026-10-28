import { serving } from "../paint/eleventy.js";

// The paint studio only exists on the local dev server (`npm start`), never in the built site.
export default {
  permalink: serving ? "/studio/" : false,
  eleventyExcludeFromCollections: true,
};
