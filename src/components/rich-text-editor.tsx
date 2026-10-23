"use client";

import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";

type Props = {
  defaultValue?: string;
  placeholder?: string;
  /** เรียกทุกครั้งที่เนื้อหาเปลี่ยน — ผู้เรียกควรเก็บไว้ใน useRef ไม่ใช่ useState (พิมพ์จะได้ไม่หน่วง) */
  onChange: (html: string) => void;
  minHeight?: string;
};

export function RichTextEditor({ defaultValue = "", placeholder, onChange, minHeight = "12rem" }: Props) {
  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        code: false,
        codeBlock: false,
        link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
      }),
      Placeholder.configure({ placeholder: placeholder ?? "" }),
    ],
    content: defaultValue,
    editorProps: {
      attributes: { class: "px-3 py-2 focus:outline-none", style: `min-height:${minHeight}` },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  return (
    <div className="overflow-hidden rounded-lg border border-slate-300 bg-white focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-200">
      {editor ? <Toolbar editor={editor} /> : <div className="h-10 border-b border-slate-200 bg-slate-50" />}
      <div className="email-content text-base">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const s = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor.isActive("bold"),
      italic: editor.isActive("italic"),
      underline: editor.isActive("underline"),
      bullet: editor.isActive("bulletList"),
      ordered: editor.isActive("orderedList"),
      link: editor.isActive("link"),
    }),
  });

  const setLink = () => {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("ใส่ลิงก์ (เว้นว่างเพื่อลบลิงก์)", prev ?? "https://");
    if (url === null) return;
    if (url.trim() === "" || url.trim() === "https://") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    } else {
      editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-slate-200 bg-slate-50 px-1.5 py-1">
      <Btn active={s.bold} title="ตัวหนา" onClick={() => editor.chain().focus().toggleBold().run()}>
        <b>B</b>
      </Btn>
      <Btn active={s.italic} title="ตัวเอียง" onClick={() => editor.chain().focus().toggleItalic().run()}>
        <i>I</i>
      </Btn>
      <Btn active={s.underline} title="ขีดเส้นใต้" onClick={() => editor.chain().focus().toggleUnderline().run()}>
        <u>U</u>
      </Btn>
      <Sep />
      <Btn active={s.bullet} title="รายการแบบจุด" onClick={() => editor.chain().focus().toggleBulletList().run()}>
        • รายการ
      </Btn>
      <Btn active={s.ordered} title="รายการแบบตัวเลข" onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        1. รายการ
      </Btn>
      <Btn active={s.link} title="ใส่ลิงก์" onClick={setLink}>
        ลิงก์
      </Btn>
      <Sep />
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => editor.chain().focus().insertContent("{ชื่อ}").run()}
        className="rounded bg-blue-50 px-2 py-1 text-sm font-medium text-blue-700 hover:bg-blue-100"
        title="แทรกชื่อผู้รับ — ระบบจะเปลี่ยนเป็นชื่อของแต่ละคนตอนส่ง"
      >
        + ใส่ชื่อผู้รับ
      </button>
    </div>
  );
}

function Btn({
  active,
  title,
  onClick,
  children,
}: {
  active?: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`min-w-8 rounded px-2 py-1 text-sm ${
        active ? "bg-blue-100 text-blue-800" : "text-slate-700 hover:bg-slate-200"
      }`}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <span className="mx-1 h-5 w-px bg-slate-300" />;
}
