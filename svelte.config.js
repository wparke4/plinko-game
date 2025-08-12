import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  // Consult https://kit.svelte.dev/docs/integrations#preprocessors
  // for more information about preprocessors
  preprocess: vitePreprocess(),

  kit: {
    // Use static adapter for prerendered static site
    adapter: adapter({
      // Generate a fallback page for SPA functionality
      fallback: 'index.html',
      // Specify the build output directory for Vercel
      pages: 'build',
      assets: 'build'
    }),
  },
};

export default config;
