import { useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { collectStoragePaths, applySignedUrls } from '../utils/contentHelpers'

export const useContentHydration = (session) => {
  const hydrateContentWithSignedUrls = useCallback(
    async (content) => {
      if (!session) return content
      const paths = new Set()
      collectStoragePaths(content, paths)
      if (paths.size === 0) return content

      const entries = await Promise.all(
        Array.from(paths).map(async (path) => {
          const { data, error } = await supabase.storage
            .from('tracker-images')
            .createSignedUrl(path, 60 * 60)
          if (error || !data?.signedUrl) return [path, null]
          return [path, data.signedUrl]
        }),
      )

      const signedMap = entries.reduce((acc, [path, url]) => {
        if (url) acc[path] = url
        return acc
      }, {})

      return applySignedUrls(content, signedMap)
    },
    [session],
  )

  return hydrateContentWithSignedUrls
}
