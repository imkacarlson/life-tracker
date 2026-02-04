import { useCallback } from 'react'
import { supabase } from '../lib/supabase'

export const useImageUpload = (session, editor, setMessage) => {
  const uploadImageAndInsert = useCallback(
    async (file) => {
      if (!session || !editor) return
      setMessage('')

      const fileExt = file.name.split('.').pop()
      const fileName = `${crypto.randomUUID?.() ?? Date.now()}.${fileExt}`
      const filePath = `${session.user.id}/${fileName}`

      const { data, error } = await supabase.storage
        .from('tracker-images')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false,
        })

      if (error) {
        setMessage(error.message)
        return
      }

      const { data: signedData, error: signedError } = await supabase.storage
        .from('tracker-images')
        .createSignedUrl(data.path, 60 * 60)

      if (signedError || !signedData?.signedUrl) {
        setMessage(signedError?.message ?? 'Unable to create signed image URL.')
        return
      }

      editor
        .chain()
        .focus()
        .setImage({ src: signedData.signedUrl, alt: file.name, storagePath: data.path })
        .run()
    },
    [session, editor, setMessage],
  )

  return uploadImageAndInsert
}
