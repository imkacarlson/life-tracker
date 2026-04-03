import { useCallback } from 'react'
import { supabase } from '../lib/supabase'

const MAX_IMAGE_SIZE = 10 * 1024 * 1024 // 10 MB
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif']

export const useImageUpload = (session, editor, setMessage) => {
  const uploadImageAndInsert = useCallback(
    async (file) => {
      if (!session || !editor) return
      setMessage('')

      if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
        setMessage('Unsupported image type. Use JPEG, PNG, GIF, WebP, or AVIF.')
        return
      }

      if (file.size > MAX_IMAGE_SIZE) {
        setMessage('Image too large (max 10 MB).')
        return
      }

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
