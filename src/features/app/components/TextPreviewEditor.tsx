import { useEffect, useRef } from 'react'
import { Compartment, EditorState } from '@codemirror/state'
import { LanguageDescription, HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { tags as t } from '@lezer/highlight'
import { EditorView, keymap } from '@codemirror/view'

const textHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: 'var(--mf-preview-code-token-keyword)', fontWeight: '600' },
  { tag: [t.name, t.propertyName, t.variableName], color: 'var(--mf-preview-code-token-name)' },
  { tag: [t.function(t.variableName), t.labelName], color: 'var(--mf-preview-code-token-function)' },
  { tag: [t.number, t.integer, t.float, t.bool], color: 'var(--mf-preview-code-token-number)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--mf-preview-code-token-string)' },
  { tag: [t.operator, t.punctuation], color: 'var(--mf-preview-code-token-operator)' },
  { tag: [t.comment, t.meta], color: 'var(--mf-preview-code-token-comment)', fontStyle: 'italic' },
  { tag: [t.link, t.url], color: 'var(--mf-preview-code-token-link)', textDecoration: 'underline' },
])

const textEditorTheme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--mf-panel-bg)',
    color: 'var(--mf-field-text)',
    height: '100%',
  },
  '.cm-content': {
    fontFamily: '"JetBrains Mono", "SFMono-Regular", Menlo, Consolas, monospace',
    fontSize: '13px',
    lineHeight: '1.7',
    minHeight: '100%',
    padding: '16px',
  },
  '.cm-scroller': {
    overflow: 'auto',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--mf-panel-bg)',
    borderRight: '1px solid var(--mf-preview-border)',
    color: 'var(--mf-muted)',
  },
  '.cm-activeLine': {
    backgroundColor: 'var(--mf-code-line-active)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'var(--mf-code-line-active)',
  },
  '.cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--mf-code-selection)',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--mf-code-cursor)',
  },
})

type TextPreviewEditorProps = {
  fileName: string
  onChange: (nextValue: string) => void
  onSave?: () => Promise<unknown> | unknown
  readOnly?: boolean
  value: string
}

export function TextPreviewEditor({ fileName, onChange, onSave, readOnly = false, value }: TextPreviewEditorProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const languageCompartmentRef = useRef(new Compartment())
  const editableCompartmentRef = useRef(new Compartment())
  const saveKeymapCompartmentRef = useRef(new Compartment())
  const suppressChangeRef = useRef(false)
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  const initialValueRef = useRef(value)
  const initialReadOnlyRef = useRef(readOnly)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    onSaveRef.current = onSave
  }, [onSave])

  useEffect(() => {
    const root = rootRef.current
    if (!root) {
      return
    }

    const saveKeymap = initialReadOnlyRef.current
      ? []
      : [
          keymap.of([
            {
              key: 'Mod-s',
              run: () => {
                void onSaveRef.current?.()
                return true
              },
            },
          ]),
        ]

    const view = new EditorView({
      state: EditorState.create({
        doc: initialValueRef.current,
        extensions: [
          EditorView.lineWrapping,
          syntaxHighlighting(textHighlightStyle),
          textEditorTheme,
          EditorView.contentAttributes.of({
            autocapitalize: 'off',
            autocorrect: 'off',
            spellcheck: 'false',
          }),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged || suppressChangeRef.current) {
              return
            }
            onChangeRef.current(update.state.doc.toString())
          }),
          editableCompartmentRef.current.of(EditorView.editable.of(!initialReadOnlyRef.current)),
          saveKeymapCompartmentRef.current.of(saveKeymap),
          languageCompartmentRef.current.of([]),
        ],
      }),
      parent: root,
    })

    viewRef.current = view
    return () => {
      viewRef.current = null
      view.destroy()
    }
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view) {
      return
    }
    const currentValue = view.state.doc.toString()
    if (currentValue === value) {
      return
    }

    suppressChangeRef.current = true
    view.dispatch({
      changes: {
        from: 0,
        insert: value,
        to: currentValue.length,
      },
    })
    suppressChangeRef.current = false
  }, [value])

  useEffect(() => {
    const view = viewRef.current
    if (!view) {
      return
    }
    view.dispatch({
      effects: editableCompartmentRef.current.reconfigure(EditorView.editable.of(!readOnly)),
    })
  }, [readOnly])

  useEffect(() => {
    const view = viewRef.current
    if (!view) {
      return
    }
    const saveKeymap = readOnly
      ? []
      : [
          keymap.of([
            {
              key: 'Mod-s',
              run: () => {
                void onSaveRef.current?.()
                return true
              },
            },
          ]),
        ]

    view.dispatch({
      effects: saveKeymapCompartmentRef.current.reconfigure(saveKeymap),
    })
  }, [onSave, readOnly])

  useEffect(() => {
    const view = viewRef.current
    if (!view) {
      return
    }

    let cancelled = false

    const loadLanguage = async () => {
      const matched = LanguageDescription.matchFilename(languages, fileName.toLowerCase())
      if (!matched) {
        if (!cancelled) {
          view.dispatch({ effects: languageCompartmentRef.current.reconfigure([]) })
        }
        return
      }

      try {
        const support = await matched.load()
        if (cancelled) {
          return
        }
        view.dispatch({ effects: languageCompartmentRef.current.reconfigure([support]) })
      } catch {
        if (!cancelled) {
          view.dispatch({ effects: languageCompartmentRef.current.reconfigure([]) })
        }
      }
    }

    void loadLanguage()

    return () => {
      cancelled = true
    }
  }, [fileName])

  return (
    <div className="h-full min-h-[220px] overflow-hidden rounded-[8px] border border-[var(--mf-preview-border)] bg-[var(--mf-panel-bg)]">
      <div ref={rootRef} className="h-full" />
    </div>
  )
}
