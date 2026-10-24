"use client";

import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";
import { BackgroundColor, Color, FontFamily, FontSize, TextStyle } from "@tiptap/extension-text-style";
import TextAlign from "@tiptap/extension-text-align";
import { useEffect, useRef, useState } from "react";
import { COLORS, FONTS, Indent, SIZES } from "@/lib/editor-extensions";

type Props = {
  defaultValue?: string;
  placeholder?: string;
  /** เรียกทุกครั้งที่เนื้อหาเปลี่ยน — ผู้เรียกควรเก็บไว้ใน useRef หรือหน่วงก่อนเก็บลง state (พิมพ์จะได้ไม่หน่วง) */
  onChange: (html: string) => void;
  minHeight?: string;
};

export function RichTextEditor({ defaultValue = "", placeholder, onChange, minHeight = "14rem" }: Props) {
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
      TextStyle,
      Color,
      BackgroundColor,
      FontFamily,
      FontSize,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Indent,
      Placeholder.configure({ placeholder: placeholder ?? "" }),
    ],
    content: defaultValue,
    editorProps: {
      attributes: { class: "px-4 py-3 focus:outline-none", style: `min-height:${minHeight}` },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  return (
    <div className="rounded-lg border border-slate-300 bg-white focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-200">
      <div className="email-content overflow-hidden rounded-t-lg">
        <EditorContent editor={editor} />
      </div>
      {editor ? <Toolbar editor={editor} /> : <div className="h-11 border-t border-slate-200 bg-slate-50" />}
    </div>
  );
}

// =====================================================================
// แถบเครื่องมือ (แบบ Gmail)
// =====================================================================

function Toolbar({ editor }: { editor: Editor }) {
  const s = useEditorState({
    editor,
    selector: ({ editor }) => {
      const style = editor.getAttributes("textStyle");
      return {
        bold: editor.isActive("bold"),
        italic: editor.isActive("italic"),
        underline: editor.isActive("underline"),
        strike: editor.isActive("strike"),
        bullet: editor.isActive("bulletList"),
        ordered: editor.isActive("orderedList"),
        quote: editor.isActive("blockquote"),
        link: editor.isActive("link"),
        align: (["center", "right", "justify"].find((a) => editor.isActive({ textAlign: a })) ?? "left") as string,
        font: (style.fontFamily as string | undefined) ?? null,
        size: (style.fontSize as string | undefined) ?? null,
        color: (style.color as string | undefined) ?? null,
        canUndo: editor.can().undo(),
        canRedo: editor.can().redo(),
      };
    },
  });
  const c = () => editor.chain().focus();

  const setLink = () => {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("ใส่ลิงก์ (เว้นว่างเพื่อลบลิงก์)", prev ?? "https://");
    if (url === null) return;
    if (url.trim() === "" || url.trim() === "https://") c().extendMarkRange("link").unsetLink().run();
    else c().extendMarkRange("link").setLink({ href: url.trim() }).run();
  };

  const fontLabel = FONTS.find((f) => f.value === s.font)?.label.replace(/ \(.*\)$/, "") ?? "แบบอักษร";

  return (
    <div className="flex flex-wrap items-center gap-0.5 rounded-b-lg border-t border-slate-200 bg-slate-50 px-1.5 py-1">
      <Btn title="เลิกทำ (Ctrl+Z)" disabled={!s.canUndo} onClick={() => c().undo().run()}>
        <Icon d={P.undo} />
      </Btn>
      <Btn title="ทำซ้ำ (Ctrl+Y)" disabled={!s.canRedo} onClick={() => c().redo().run()}>
        <Icon d={P.redo} />
      </Btn>
      <Sep />

      <Dropdown title="แบบอักษร" label={<span className="max-w-24 truncate text-sm">{fontLabel}</span>}>
        {(close) =>
          FONTS.map((f) => (
            <MenuItem
              key={f.label}
              active={s.font === f.value}
              style={{ fontFamily: f.value ?? undefined }}
              onClick={() => {
                if (f.value) c().setFontFamily(f.value).run();
                else c().unsetFontFamily().run();
                close();
              }}
            >
              {f.label}
            </MenuItem>
          ))
        }
      </Dropdown>
      <Dropdown title="ขนาดตัวอักษร" label={<Icon d={P.size} />}>
        {(close) =>
          SIZES.map((z) => (
            <MenuItem
              key={z.label}
              active={s.size === z.value}
              style={{ fontSize: z.value ?? "15px" }}
              onClick={() => {
                if (z.value) c().setFontSize(z.value).run();
                else c().unsetFontSize().run();
                close();
              }}
            >
              {z.label}
            </MenuItem>
          ))
        }
      </Dropdown>
      <Sep />

      <Btn title="ตัวหนา (Ctrl+B)" active={s.bold} onClick={() => c().toggleBold().run()}>
        <Icon d={P.bold} />
      </Btn>
      <Btn title="ตัวเอียง (Ctrl+I)" active={s.italic} onClick={() => c().toggleItalic().run()}>
        <Icon d={P.italic} />
      </Btn>
      <Btn title="ขีดเส้นใต้ (Ctrl+U)" active={s.underline} onClick={() => c().toggleUnderline().run()}>
        <Icon d={P.underline} />
      </Btn>
      <Dropdown title="สีข้อความ" label={<ColorIcon color={s.color} />} wide>
        {(close) => (
          <div className="grid gap-3 p-2 sm:grid-cols-2">
            <Palette
              title="สีพื้นหลัง"
              onPick={(col) => {
                if (col) c().setBackgroundColor(col).run();
                else c().unsetBackgroundColor().run();
                close();
              }}
            />
            <Palette
              title="สีตัวอักษร"
              onPick={(col) => {
                if (col) c().setColor(col).run();
                else c().unsetColor().run();
                close();
              }}
            />
          </div>
        )}
      </Dropdown>
      <Sep />

      <Dropdown title="จัดแนว" label={<Icon d={P[`align_${s.align}` as keyof typeof P] ?? P.align_left} />}>
        {(close) =>
          (["left", "center", "right", "justify"] as const).map((a) => (
            <MenuItem
              key={a}
              active={s.align === a}
              onClick={() => {
                c().setTextAlign(a).run();
                close();
              }}
            >
              <span className="flex items-center gap-2">
                <Icon d={P[`align_${a}`]} />
                {{ left: "ชิดซ้าย", center: "กึ่งกลาง", right: "ชิดขวา", justify: "เต็มบรรทัด" }[a]}
              </span>
            </MenuItem>
          ))
        }
      </Dropdown>
      <Btn title="รายการแบบตัวเลข" active={s.ordered} onClick={() => c().toggleOrderedList().run()}>
        <Icon d={P.ol} />
      </Btn>
      <Btn title="รายการแบบจุด" active={s.bullet} onClick={() => c().toggleBulletList().run()}>
        <Icon d={P.ul} />
      </Btn>
      <Btn title="ลดการเยื้อง (Shift+Tab)" onClick={() => c().outdent().run()}>
        <Icon d={P.outdent} />
      </Btn>
      <Btn title="เพิ่มการเยื้อง (Tab)" onClick={() => c().indent().run()}>
        <Icon d={P.indent} />
      </Btn>
      <Btn title="ข้อความอ้างอิง" active={s.quote} onClick={() => c().toggleBlockquote().run()}>
        <Icon d={P.quote} />
      </Btn>
      <Btn title="ขีดฆ่า" active={s.strike} onClick={() => c().toggleStrike().run()}>
        <Icon d={P.strike} />
      </Btn>
      <Sep />
      <Btn title="ใส่ลิงก์" active={s.link} onClick={setLink}>
        <Icon d={P.link} />
      </Btn>
      <Btn title="เส้นคั่น" onClick={() => c().setHorizontalRule().run()}>
        <Icon d={P.hr} />
      </Btn>
      <Btn title="ล้างรูปแบบ" onClick={() => c().unsetAllMarks().unsetTextAlign().clearNodes().run()}>
        <Icon d={P.clear} />
      </Btn>
      <Sep />
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => c().insertContent("{ชื่อ}").run()}
        className="rounded-md bg-blue-50 px-2.5 py-1 text-sm font-medium text-blue-700 hover:bg-blue-100"
        title="แทรกชื่อผู้รับ — ระบบจะเปลี่ยนเป็นชื่อของแต่ละคนตอนส่ง"
      >
        + ใส่ชื่อผู้รับ
      </button>
    </div>
  );
}

// ---------- ชิ้นส่วนแถบเครื่องมือ ----------

function Btn({
  active,
  disabled,
  title,
  onClick,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
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
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`flex h-8 min-w-8 items-center justify-center rounded-md px-1 disabled:opacity-30 ${
        active ? "bg-blue-100 text-blue-800" : "text-slate-700 hover:bg-slate-200"
      }`}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <span className="mx-0.5 h-5 w-px bg-slate-300" />;
}

/** ปุ่มที่กดแล้วมีเมนูเด้งขึ้น (ปิดเองเมื่อคลิกที่อื่น) */
function Dropdown({
  title,
  label,
  wide,
  children,
}: {
  title: string;
  label: React.ReactNode;
  wide?: boolean;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        title={title}
        aria-label={title}
        aria-expanded={open}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
        className={`flex h-8 items-center gap-0.5 rounded-md px-1.5 text-slate-700 hover:bg-slate-200 ${open ? "bg-slate-200" : ""}`}
      >
        {label}
        <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden>
          <path d="M7 10l5 5 5-5z" />
        </svg>
      </button>
      {open && (
        <div
          className={`absolute bottom-full left-0 z-20 mb-1 max-h-80 overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg ${
            wide ? "w-72 sm:w-[30rem]" : "w-52"
          }`}
          onMouseDown={(e) => e.preventDefault()}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

function MenuItem({
  active,
  style,
  onClick,
  children,
}: {
  active?: boolean;
  style?: React.CSSProperties;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      style={style}
      onClick={onClick}
      className={`block w-full px-3 py-1.5 text-left hover:bg-slate-100 ${active ? "bg-blue-50 text-blue-800" : "text-slate-800"}`}
    >
      {active ? "✓ " : ""}
      {children}
    </button>
  );
}

function Palette({ title, onPick }: { title: string; onPick: (color: string | null) => void }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
        <span>{title}</span>
        <button type="button" className="text-blue-700 hover:underline" onClick={() => onPick(null)}>
          ไม่มีสี
        </button>
      </div>
      <div className="grid grid-cols-8 gap-1">
        {COLORS.map((col) => (
          <button
            key={col}
            type="button"
            title={col}
            aria-label={`${title} ${col}`}
            onClick={() => onPick(col)}
            className="h-5 w-5 rounded-sm border border-slate-300 hover:scale-125"
            style={{ backgroundColor: col }}
          />
        ))}
      </div>
    </div>
  );
}

function ColorIcon({ color }: { color: string | null }) {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
      <path className="fill-current" d="M5.49 17h2.42l1.27-3.58h5.65L16.09 17h2.42L13.25 3h-2.5L5.49 17zm4.42-5.61 2.03-5.79h.12l2.03 5.79H9.91z" />
      <rect x="2" y="19.5" width="20" height="3.5" fill={color ?? "#000000"} />
    </svg>
  );
}

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden>
      <path d={d} />
    </svg>
  );
}

// ไอคอนแบบ Material (24x24)
const P = {
  undo: "M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z",
  redo: "M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22L3.9 16c1.05-3.19 4.05-5.5 7.6-5.5 1.95 0 3.73.72 5.12 1.88L13 16h9V7l-3.6 3.6z",
  size: "M9 4v3h5v12h3V7h5V4H9zm-6 8h3v7h3v-7h3V9H3v3z",
  bold: "M15.6 10.79c.97-.67 1.65-1.77 1.65-2.79 0-2.26-1.75-4-4-4H7v14h7.04c2.09 0 3.71-1.7 3.71-3.79 0-1.52-.86-2.82-2.15-3.42zM10 6.5h3c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5h-3v-3zm3.5 9H10v-3h3.5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5z",
  italic: "M10 4v3h2.21l-3.42 8H6v3h8v-3h-2.21l3.42-8H18V4z",
  underline: "M12 17c3.31 0 6-2.69 6-6V3h-2.5v8c0 1.93-1.57 3.5-3.5 3.5S8.5 12.93 8.5 11V3H6v8c0 3.31 2.69 6 6 6zm-7 2v2h14v-2H5z",
  strike: "M10 19h4v-3h-4v3zM5 4v3h5v3h4V7h5V4H5zM3 14h18v-2H3v2z",
  align_left: "M15 15H3v2h12v-2zm0-8H3v2h12V7zM3 13h18v-2H3v2zm0 8h18v-2H3v2zM3 3v2h18V3H3z",
  align_center: "M7 15v2h10v-2H7zm-4 6h18v-2H3v2zm0-8h18v-2H3v2zm4-6v2h10V7H7zM3 3v2h18V3H3z",
  align_right: "M3 21h18v-2H3v2zm6-4h12v-2H9v2zm-6-4h18v-2H3v2zm6-4h12V7H9v2zM3 3v2h18V3H3z",
  align_justify: "M3 21h18v-2H3v2zm0-4h18v-2H3v2zm0-4h18v-2H3v2zm0-4h18V7H3v2zm0-6v2h18V3H3z",
  ol: "M2 17h2v.5H3v1h1v.5H2v1h3v-4H2v1zm1-9h1V4H2v1h1v3zm-1 3h1.8L2 13.1v.9h3v-1H3.2L5 10.9V10H2v1zm5-6v2h14V5H7zm0 14h14v-2H7v2zm0-6h14v-2H7v2z",
  ul: "M4 10.5c-.83 0-1.5.67-1.5 1.5s.67 1.5 1.5 1.5 1.5-.67 1.5-1.5-.67-1.5-1.5-1.5zm0-6c-.83 0-1.5.67-1.5 1.5S3.17 7.5 4 7.5 5.5 6.83 5.5 6 4.83 4.5 4 4.5zm0 12c-.83 0-1.5.68-1.5 1.5s.68 1.5 1.5 1.5 1.5-.68 1.5-1.5-.67-1.5-1.5-1.5zM7 19h14v-2H7v2zm0-6h14v-2H7v2zm0-8v2h14V5H7z",
  outdent: "M11 17h10v-2H11v2zm-8-5l4 4V8l-4 4zm0 9h18v-2H3v2zM3 3v2h18V3H3zm8 6h10V7H11v2zm0 4h10v-2H11v2z",
  indent: "M3 21h18v-2H3v2zM3 8v8l4-4-4-4zm8 9h10v-2H11v2zM3 3v2h18V3H3zm8 6h10V7H11v2zm0 4h10v-2H11v2z",
  quote: "M6 17h3l2-4V7H5v6h3zm8 0h3l2-4V7h-6v6h3z",
  link: "M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z",
  hr: "M4 11h16v2H4z",
  clear: "M3.27 5L2 6.27l6.97 6.97L6.5 19h3l1.57-3.66L16.73 21 18 19.73 3.55 5.27 3.27 5zM6 5v.18L8.82 8h2.4l-.72 1.68 2.1 2.1L14.21 8H20V5H6z",
};
