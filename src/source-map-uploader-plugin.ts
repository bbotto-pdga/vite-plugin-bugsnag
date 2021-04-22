import { extname, resolve } from 'path'
import { existsSync } from 'fs'
import glob from 'fast-glob'

import type { Plugin } from 'vite'
import { browser } from '@bugsnag/source-maps'

import { blue } from 'chalk'
import type { Sourcemap, SourceMapUploaderConfig } from './types'

import { debug, warn, limitParallelism } from './utils'

export default function BugsnagSourceMapUploaderPlugin (config: SourceMapUploaderConfig): Plugin {
  // eslint-disable-next-line prefer-const
  let { base, ignoredBundleExtensions = ['.css'], ...options } = config

  if (typeof options.apiKey !== 'string' || options.apiKey.length < 1)
    throw new Error(`[BugsnagSourceMapUploader] "apiKey" is required.\nProvided:\n${JSON.stringify(options)}`)

  function uploadSourcemap ({ url, source, map }: Sourcemap) {
    debug(`uploading sourcemap for "${blue(url)}"`)
    return browser.uploadOne({
      bundleUrl: url,
      bundle: source,
      sourceMap: map,
      ...options,
    })
  }

  return {
    name: 'bugsnag-source-map-uploader',

    /**
     * Enables sourcemap generation unless the option is explicitly disabled.
     */
    config ({ build }, { mode }) {
      return {
        build: {
          sourcemap: build?.sourcemap !== undefined ? build.sourcemap : mode !== 'development',
        },
      }
    },

    configResolved (config) {
      if (base === undefined) base = config.base

      // Ensure base has a trailing slash
      base = base.replace(/[^/]$/, '$&/')
    },

    async writeBundle (outputConfig, bundle) {
      const outputDir = outputConfig.dir || ''

      function sourcemapFromFile (mapPath: string): Sourcemap[] {
        const sourcePath = mapPath.replace(/\.map$/, '')
        const sourceFilename = resolve(outputDir, sourcePath)

        if (ignoredBundleExtensions.includes(extname(sourcePath)))
          return []

        if (!existsSync(sourceFilename)) {
          warn(`no corresponding source found for "${mapPath}"`)
          return []
        }

        return [{
          map: resolve(outputDir, mapPath),
          source: sourceFilename,
          url: `${base}${sourcePath}`,
        }]
      }

      const files = await glob('./**/*.map', { cwd: outputDir })
      const sourcemaps = files.flatMap(sourcemapFromFile)
      console.log('result', { files, sourcemaps })
      await Promise.all(
        sourcemaps.map(sourcemap => limitParallelism(() => uploadSourcemap(sourcemap))),
      )
    },
  }
}