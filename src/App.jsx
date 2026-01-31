import { useCallback, useEffect, useRef, useState } from 'react'
import { useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import Highlight from '@tiptap/extension-highlight'
import Underline from '@tiptap/extension-underline'
import TextAlign from '@tiptap/extension-text-align'
import Color from '@tiptap/extension-color'
import { TextStyle } from '@tiptap/extension-text-style'
import Placeholder from '@tiptap/extension-placeholder'
import BulletList from '@tiptap/extension-bullet-list'
import OrderedList from '@tiptap/extension-ordered-list'
import ListItem from '@tiptap/extension-list-item'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { supabase } from './lib/supabase'
import Sidebar from './components/Sidebar'
import EditorPanel from './components/EditorPanel'
import './App.css'

const EMPTY_DOC = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
}

const normalizeContent = (content) => {
  if (content && typeof content === 'object' && content.type) return content
  return EMPTY_DOC
}

const SecureImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      storagePath: {
        default: null,
      },
    }
  },
})

const collectStoragePaths = (node, paths) => {
  if (!node) return
  if (node.type === 'image' && node.attrs?.storagePath) {
    paths.add(node.attrs.storagePath)
  }
  if (Array.isArray(node.content)) {
    node.content.forEach((child) => collectStoragePaths(child, paths))
  }
}

const applySignedUrls = (node, signedMap) => {
  if (!node) return node
  let updatedNode = node
  if (node.type === 'image' && node.attrs?.storagePath) {
    const nextSrc = signedMap[node.attrs.storagePath]
    if (nextSrc) {
      updatedNode = {
        ...node,
        attrs: {
          ...node.attrs,
          src: nextSrc,
        },
      }
    }
  }
  if (Array.isArray(updatedNode.content)) {
    return {
      ...updatedNode,
      content: updatedNode.content.map((child) => applySignedUrls(child, signedMap)),
    }
  }
  return updatedNode
}

const sanitizeContentForSave = (content) => {
  const walk = (node) => {
    if (!node || typeof node !== 'object') return node
    let updatedNode = node
    if (node.type === 'image' && node.attrs?.storagePath) {
      updatedNode = {
        ...node,
        attrs: {
          ...node.attrs,
          src: null,
        },
      }
    }
    if (Array.isArray(updatedNode.content)) {
      return {
        ...updatedNode,
        content: updatedNode.content.map((child) => walk(child)),
      }
    }
    return updatedNode
  }

  return walk(normalizeContent(content))
}

function App() {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
  const missingEnv = !supabaseUrl || !supabaseAnonKey

  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [trackers, setTrackers] = useState([])
  const [activeTrackerId, setActiveTrackerId] = useState(null)
  const [titleDraft, setTitleDraft] = useState('')
  const [saveStatus, setSaveStatus] = useState('Saved')
  const [dataLoading, setDataLoading] = useState(false)

  const saveTimerRef = useRef(null)
  const titleDraftRef = useRef(titleDraft)
  const activeTrackerRef = useRef(null)
  const uploadImageRef = useRef(null)

  const activeTracker = trackers.find((tracker) => tracker.id === activeTrackerId) ?? null

  useEffect(() => {
    titleDraftRef.current = titleDraft
  }, [titleDraft])

  useEffect(() => {
    activeTrackerRef.current = activeTracker
  }, [activeTracker])

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (missingEnv) {
      setLoading(false)
      return
    }

    let mounted = true

    supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) return
      if (error) setMessage(error.message)
      setSession(data.session)
      setLoading(false)
    })

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setLoading(false)
    })

    return () => {
      mounted = false
      authListener.subscription.unsubscribe()
    }
  }, [missingEnv])

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          bulletList: false,
          orderedList: false,
          listItem: false,
        }),
        BulletList,
        OrderedList,
        ListItem,
        TaskList.configure({ nested: true }),
        TaskItem.configure({ nested: true }),
        Underline,
        Highlight.configure({ multicolor: true }),
        TextStyle,
        Color,
        TextAlign.configure({ types: ['heading', 'paragraph'] }),
        Link.configure({
          autolink: true,
          openOnClick: false,
          linkOnPaste: true,
        }),
        SecureImage.configure({ inline: false, allowBase64: false }),
        Table.configure({ resizable: true }),
        TableRow,
        TableHeader,
        TableCell,
        Placeholder.configure({
          placeholder: 'Start writing your tracker...',
        }),
      ],
      content: EMPTY_DOC,
      editorProps: {
        attributes: {
          class: 'editor-content',
        },
        handlePaste: (_view, event) => {
          const files = event.clipboardData?.files
          if (!files || files.length === 0) return false
          const imageFile = Array.from(files).find((file) => file.type.startsWith('image/'))
          if (!imageFile) return false
          event.preventDefault()
          uploadImageRef.current?.(imageFile)
          return true
        },
        handleDrop: (_view, event, _slice, moved) => {
          if (moved) return false
          const files = event.dataTransfer?.files
          if (!files || files.length === 0) return false
          const imageFile = Array.from(files).find((file) => file.type.startsWith('image/'))
          if (!imageFile) return false
          event.preventDefault()
          uploadImageRef.current?.(imageFile)
          return true
        },
      },
    },
    [session?.user?.id],
  )

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

  useEffect(() => {
    if (!editor) return
    let mounted = true
    const setContent = async () => {
      const rawContent = normalizeContent(activeTracker?.content)
      const hydrated = await hydrateContentWithSignedUrls(rawContent)
      if (!mounted) return
      editor.commands.setContent(hydrated, false)
    }
    setContent()
    return () => {
      mounted = false
    }
  }, [editor, activeTrackerId, hydrateContentWithSignedUrls])

  useEffect(() => {
    if (activeTracker) {
      setTitleDraft(activeTracker.title)
    } else {
      setTitleDraft('')
    }
    setSaveStatus('Saved')
  }, [activeTrackerId])

  const loadTrackers = useCallback(async () => {
    if (!session) return
    setDataLoading(true)
    setMessage('')
    const { data, error } = await supabase
      .from('trackers')
      .select('id, title, content, created_at, updated_at')
      .order('updated_at', { ascending: false })

    if (error) {
      setMessage(error.message)
      setDataLoading(false)
      return
    }

    setTrackers(data ?? [])
    setActiveTrackerId((prev) => prev ?? (data?.[0]?.id ?? null))
    setDataLoading(false)
  }, [session])

  useEffect(() => {
    if (!session) return
    loadTrackers()
  }, [session, loadTrackers])

  const scheduleSave = useCallback(
    (nextContent) => {
      const tracker = activeTrackerRef.current
      if (!tracker) return

      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
      }

      setSaveStatus('Saving...')

      saveTimerRef.current = setTimeout(async () => {
        const payload = {
          title: titleDraftRef.current?.trim() || 'Untitled Tracker',
          content: sanitizeContentForSave(nextContent),
          updated_at: new Date().toISOString(),
        }

        const { error } = await supabase.from('trackers').update(payload).eq('id', tracker.id)

        if (error) {
          setMessage(error.message)
          setSaveStatus('Error')
          return
        }

        setTrackers((prev) =>
          prev.map((item) => (item.id === tracker.id ? { ...item, ...payload } : item)),
        )
        setSaveStatus('Saved')
      }, 2000)
    },
    [setTrackers],
  )

  useEffect(() => {
    if (!editor) return
    const handleUpdate = () => {
      if (!activeTrackerRef.current) return
      scheduleSave(editor.getJSON())
    }
    editor.on('update', handleUpdate)
    return () => editor.off('update', handleUpdate)
  }, [editor, scheduleSave])

  const handleTitleChange = (value) => {
    setTitleDraft(value)
    if (!editor || !activeTrackerRef.current) return
    scheduleSave(editor.getJSON())
  }

  const handleCreateTracker = async () => {
    if (!session) return
    setMessage('')
    const title = `${new Date().toLocaleString('en-US', {
      month: 'long',
      year: 'numeric',
    })} Tracker`

    const { data, error } = await supabase
      .from('trackers')
      .insert({
        title,
        user_id: session.user.id,
        content: EMPTY_DOC,
      })
      .select()
      .single()

    if (error) {
      setMessage(error.message)
      return
    }

    setTrackers((prev) => [data, ...prev])
    setActiveTrackerId(data.id)
  }

  const handleDeleteTracker = async () => {
    const tracker = activeTrackerRef.current
    if (!tracker) return
    const confirmDelete = window.confirm(`Delete "${tracker.title}"? This cannot be undone.`)
    if (!confirmDelete) return

    const { error } = await supabase.from('trackers').delete().eq('id', tracker.id)

    if (error) {
      setMessage(error.message)
      return
    }

    const nextTrackers = trackers.filter((item) => item.id !== tracker.id)
    setTrackers(nextTrackers)
    setActiveTrackerId((prev) => (prev === tracker.id ? nextTrackers[0]?.id ?? null : prev))
  }

  const handleSignIn = async (event) => {
    event.preventDefault()
    setMessage('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setMessage(error.message)
  }

  const handleSignOut = async () => {
    setMessage('')
    await supabase.auth.signOut()
    setTrackers([])
    setActiveTrackerId(null)
    setTitleDraft('')
  }

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
    [session, editor],
  )

  useEffect(() => {
    uploadImageRef.current = uploadImageAndInsert
  }, [uploadImageAndInsert])

  if (missingEnv) {
    return (
      <div className="app">
        <h1>Life Tracker</h1>
        <div className="card">
          <p>Missing Supabase environment variables.</p>
          <p>
            Set these in a <code>.env.local</code> file, then restart the dev server:
          </p>
          <ul>
            <li>VITE_SUPABASE_URL</li>
            <li>VITE_SUPABASE_ANON_KEY</li>
          </ul>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="app">
        <h1>Life Tracker</h1>
        <div className="card">Loading...</div>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="app app-auth">
        <h1>Life Tracker</h1>
        <div className="card">
          <h2>Sign in</h2>
          <form onSubmit={handleSignIn} className="form">
            <label className="label">
              Email
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                required
              />
            </label>
            <label className="label">
              Password
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Your password"
                required
              />
            </label>
            <div className="actions">
              <button type="submit">Sign in</button>
            </div>
          </form>
          <p className="subtle">Need access? Contact the admin.</p>
          {message && <p className="message">{message}</p>}
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>Life Tracker</h1>
          <p className="subtle">Signed in as {session.user.email}</p>
        </div>
        <button className="secondary" onClick={handleSignOut}>
          Log out
        </button>
      </header>

      <div className="workspace">
        <EditorPanel
          editor={editor}
          title={titleDraft}
          onTitleChange={handleTitleChange}
          onDelete={handleDeleteTracker}
          saveStatus={saveStatus}
          onImageUpload={uploadImageAndInsert}
          hasTracker={!!activeTracker}
          message={message}
        />
        <Sidebar
          trackers={trackers}
          activeId={activeTrackerId}
          onSelect={setActiveTrackerId}
          onCreate={handleCreateTracker}
          loading={dataLoading}
        />
      </div>
    </div>
  )
}

export default App
