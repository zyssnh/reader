import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://zyssnh.github.io',
  base: '/reader',
  output: 'static',
  integrations: [sitemap()],
});
