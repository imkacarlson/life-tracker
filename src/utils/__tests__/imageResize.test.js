import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { resizeAndEncode } from '../imageResize'

let savedImage
let savedDocument

beforeEach(() => {
  vi.restoreAllMocks()
  savedImage = globalThis.Image
  savedDocument = globalThis.document
})

afterEach(() => {
  if (savedImage) globalThis.Image = savedImage
  else delete globalThis.Image
  if (savedDocument) globalThis.document = savedDocument
  else delete globalThis.document
})

function makeFile(name = 'test.jpg', type = 'image/jpeg') {
  return new File(['fake-image-data'], name, { type })
}

function mockBrowserAPIs({
  width = 800,
  height = 600,
  loadFails = false,
  dataUrl = 'data:image/jpeg;base64,AQID',
} = {}) {
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

  globalThis.Image = class {
    constructor() {
      this.width = width
      this.height = height
    }
    set src(_v) {
      setTimeout(() => {
        if (loadFails) this.onerror?.()
        else this.onload?.()
      }, 0)
    }
  }

  const fakeCtx = { drawImage: vi.fn() }
  const fakeCanvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => fakeCtx),
    toDataURL: vi.fn(() => dataUrl),
  }

  globalThis.document = {
    createElement: vi.fn((tag) => {
      if (tag === 'canvas') return fakeCanvas
      throw new Error(`Unexpected createElement('${tag}')`)
    }),
  }

  return fakeCanvas
}

describe('resizeAndEncode', () => {
  it('returns an object with base64, mediaType, and originalName', async () => {
    const canvas = mockBrowserAPIs({ width: 800, height: 600 })

    const result = await resizeAndEncode(makeFile('recipe.jpg'))

    expect(result).toEqual({
      base64: 'AQID',
      mediaType: 'image/jpeg',
      originalName: 'recipe.jpg',
    })
    expect(canvas.toDataURL).toHaveBeenCalledWith('image/jpeg', 0.8)
  })

  it('scales down images larger than maxDim', async () => {
    const canvas = mockBrowserAPIs({ width: 4000, height: 3000 })

    await resizeAndEncode(makeFile(), 1024)

    expect(canvas.width).toBe(1024)
    expect(canvas.height).toBe(768)
  })

  it('does not upscale small images', async () => {
    const canvas = mockBrowserAPIs({ width: 500, height: 400 })

    await resizeAndEncode(makeFile(), 1024)

    expect(canvas.width).toBe(500)
    expect(canvas.height).toBe(400)
  })

  it('rejects on image load error', async () => {
    mockBrowserAPIs({ loadFails: true })

    await expect(resizeAndEncode(makeFile('bad.png'))).rejects.toThrow(
      'Failed to process image: bad.png',
    )
  })

  it('rejects when canvas produces empty output', async () => {
    mockBrowserAPIs({ dataUrl: 'data:,' })

    await expect(resizeAndEncode(makeFile('blank.jpg'))).rejects.toThrow(
      'Failed to process image: blank.jpg',
    )
  })
})
