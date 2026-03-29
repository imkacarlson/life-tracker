/**
 * Resize an image file to max 1024px (longest edge) and encode as JPEG base64.
 * Returns { base64, mediaType: 'image/jpeg', originalName }.
 */
export async function resizeAndEncode(file, maxDim = 1024, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()

    img.onload = () => {
      URL.revokeObjectURL(url)

      try {
        let { width, height } = img
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height)
          width = Math.round(width * scale)
          height = Math.round(height * scale)
        }

        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error(`Failed to process image: ${file.name}`))
          return
        }
        ctx.drawImage(img, 0, 0, width, height)

        const dataUrl = canvas.toDataURL('image/jpeg', quality)
        if (!dataUrl || dataUrl === 'data:,') {
          reject(new Error(`Failed to process image: ${file.name}`))
          return
        }

        // Strip the data:image/jpeg;base64, prefix
        const base64 = dataUrl.split(',')[1]
        if (!base64) {
          reject(new Error(`Failed to process image: ${file.name}`))
          return
        }

        resolve({ base64, mediaType: 'image/jpeg', originalName: file.name })
      } catch (err) {
        reject(new Error(`Failed to process image: ${file.name}`))
      }
    }

    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error(`Failed to process image: ${file.name}`))
    }

    img.src = url
  })
}
