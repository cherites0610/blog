// @ts-check

import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { defineConfig, fontProviders } from 'astro/config';

import readingTime from 'reading-time';

// https://astro.build/config
export default defineConfig({
  site: 'https://blog.cherites.org',
  integrations: [mdx(), sitemap()],
  markdown: {
    remarkPlugins: [
      () => (tree, file) => {
        const stats = readingTime(String(file.value));
        if (file.data.astro?.frontmatter) {
          file.data.astro.frontmatter.readingTime = stats.text;
        }
      }
    ]
  },
	fonts: [
    {
      provider: fontProviders.local(),
      name: 'Atkinson',
      cssVariable: '--font-atkinson',
      fallbacks: ['sans-serif'],
      options: {
        variants: [
          {
            src: ['./src/assets/fonts/atkinson-regular.woff'],
            weight: 400,
            style: 'normal',
            display: 'swap',
          },
          {
            src: ['./src/assets/fonts/atkinson-bold.woff'],
            weight: 700,
            style: 'normal',
            display: 'swap',
          },
        ],
      },
    },
  ],
});
