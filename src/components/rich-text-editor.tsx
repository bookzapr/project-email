"use client";

import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";
import { BackgroundColor, Color, FontFamily, FontSize, TextStyle } from "@tiptap/extension-text-style";
import TextAlign from "@tiptap/extension-text-align";
import Image from "@tiptap/extension-image";
import type { EditorView } from "@tiptap/pm/view";
import { useEffect, useRef, useState } from "react";
import { IMAGE_TYPES } from "@/lib/attachments";
import { COLORS, FONTS, Indent, SIZES } from "@/lib/editor-extensions";
import { uploadFile } from "@/lib/upload-client";

type Props = {
  defaultValue?: string;
  placeholder?: string;
  /** เรียกทุกครั้งที่เนื้อหาเปลี่ยน — ผู้เรียกควรเก็บไว้ใน useRef หรือหน่วงก่อนเก็บลง state (พิมพ์จะได้ไม่หน่วง) */
  onChange: (html: string) => void;
  minHeight?: string;
};

export function RichTextEditor({ defaultValue = "", placeholder, onChange, minHeight = "14rem" }: Props) {
  const [uploading, setUploading] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);

  /** อัปโหลดรูปแล้วแทรกที่ตำแหน่งเคอร์เซอร์ (ใช้กับปุ่ม, วาง, ลากมาวาง) */
  const insertImages = async (view: EditorView, files: File[], pos?: number) => {
    setUploadError(null);
    for (const file of files) {
      setUploading((n) => n + 1);
      const res = await uploadFile("image", file);
      setUploading((n) => n - 1);
      if ("error" in res) {
        setUploadError(res.error);
        continue;
      }
      const node = view.state.schema.nodes.image.create({ src: res.publicUrl, alt: file.name, width: 300 });
      const tr = pos != null ? view.state.tr.insert(pos, node) : view.state.tr.replaceSelectionWith(node);
      view.dispatch(tr);
    }
  };
  const imageFiles = (list: FileList | null | undefined) => [...(list ?? [])].filter((f) => f.type.startsWith("image/"));

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
      Image.configure({ inline: false, allowBase64: false }),
      Placeholder.configure({ placeholder: placeholder ?? "" }),
    ],
    content: defaultValue,
    editorProps: {
      attributes: { class: "px-4 py-3 focus:outline-none", style: `min-height:${minHeight}` },
      handlePaste: (view, event) => {
        const files = imageFiles(event.clipboardData?.files);
        if (!files.length) return false;
        void insertImages(view, files);
        return true;
      },
      handleDrop: (view, event) => {
        const files = imageFiles(event.dataTransfer?.files);
        if (!files.length) return false;
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        void insertImages(view, files, pos);
        return true;
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  return (
    <div className="rounded-lg border border-slate-300 bg-white focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-200">
      <div className="email-content overflow-hidden rounded-t-lg">
        <EditorContent editor={editor} />
      </div>
      {(uploading > 0 || uploadError) && (
        <div className={`px-4 py-1.5 text-sm ${uploadError ? "text-red-700" : "text-slate-500"}`}>
          {uploading > 0 ? `กำลังอัปโหลดรูป (${uploading})...` : uploadError}
        </div>
      )}
      {editor ? (
        <Toolbar editor={editor} onPickImages={(files) => insertImages(editor.view, files)} />
      ) : (
        <div className="h-11 border-t border-slate-200 bg-slate-50" />
      )}
    </div>
  );
}

// =====================================================================
// แถบเครื่องมือ (แบบ Gmail)
// =====================================================================

function Toolbar({ editor, onPickImages }: { editor: Editor; onPickImages: (files: File[]) => void }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [linkOpen, setLinkOpen] = useState(false);
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
        image: editor.isActive("image"),
        imageWidth: (editor.getAttributes("image").width as number | null) ?? null,
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
      <Btn title="ใส่ลิงก์" active={s.link} onClick={() => setLinkOpen(true)}>
        <Icon d={P.link} />
      </Btn>
      <Btn title="แทรกรูปภาพ" onClick={() => fileInput.current?.click()}>
        <Icon d={P.image} />
      </Btn>
      <input
        ref={fileInput}
        type="file"
        accept={IMAGE_TYPES.join(",")}
        multiple
        className="hidden"
        onChange={(e) => {
          onPickImages([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
      {s.image && (
        <Dropdown title="ขนาดรูป" label={<span className="text-sm">ขนาดรูป</span>}>
          {(close) =>
            IMAGE_WIDTHS.map((w) => (
              <MenuItem
                key={w.label}
                active={s.imageWidth === w.value}
                onClick={() => {
                  c().updateAttributes("image", { width: w.value, height: null }).run();
                  close();
                }}
              >
                {w.label}
              </MenuItem>
            ))
          }
        </Dropdown>
      )}
      {linkOpen && <LinkDialog editor={editor} onClose={() => setLinkOpen(false)} />}
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

const IMAGE_WIDTHS = [
  { label: "เล็ก", value: 150 },
  { label: "กลาง", value: 300 },
  { label: "ใหญ่", value: 450 },
  { label: "เต็มความกว้าง", value: 600 },
];

/** หน้าต่างใส่/แก้ลิงก์ แบบ Gmail: ข้อความที่แสดง + ลิงก์ */
function LinkDialog({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const { from, to, empty } = editor.state.selection;
  const prevHref = (editor.getAttributes("link").href as string | undefined) ?? "";
  const [text, setText] = useState(() => (empty ? "" : editor.state.doc.textBetween(from, to, " ")));
  const [url, setUrl] = useState(prevHref);
  const [error, setError] = useState<string | null>(null);

  const normalize = (raw: string) => {
    const u = raw.trim();
    if (!u) return "";
    if (/^(https?:|mailto:)/i.test(u)) return u;
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u)) return `mailto:${u}`;
    return `https://${u}`;
  };

  const save = () => {
    const href = normalize(url);
    if (!href) return setError("กรุณาใส่ลิงก์");
    const label = text.trim() || url.trim();
    editor
      .chain()
      .focus()
      .extendMarkRange("link")
      .insertContent({ type: "text", text: label, marks: [{ type: "link", attrs: { href } }] })
      .run();
    onClose();
  };
  const remove = () => {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label="แก้ไขลิงก์"
        className="w-full max-w-md space-y-3 rounded-xl bg-white p-5 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold">{prevHref ? "แก้ไขลิงก์" : "ใส่ลิงก์"}</h3>
        <div>
          <label htmlFor="link-text" className="label">
            ข้อความที่แสดง
          </label>
          <input
            id="link-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="input"
            placeholder="เช่น ดาวน์โหลดแบบฟอร์ม"
          />
        </div>
        <div>
          <label htmlFor="link-url" className="label">
            ลิงก์ (เว็บไซต์ หรืออีเมล)
          </label>
          <input
            id="link-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                save();
              }
            }}
            className="input"
            placeholder="https://..."
            autoFocus
          />
        </div>
        {error && <p className="alert-error">{error}</p>}
        <div className="flex items-center gap-2 pt-1">
          {prevHref && (
            <button type="button" className="text-sm text-red-600 hover:underline" onClick={remove}>
              ลบลิงก์
            </button>
          )}
          <div className="ml-auto flex gap-2">
            <button type="button" className="btn" onClick={onClose}>
              ยกเลิก
            </button>
            <button type="button" className="btn-primary" onClick={save}>
              ตกลง
            </button>
          </div>
        </div>
      </div>
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
  image: "M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z",
  attach: "M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5c0-1.38 1.12-2.5 2.5-2.5s2.5 1.12 2.5 2.5v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5c0 1.38 1.12 2.5 2.5 2.5s2.5-1.12 2.5-2.5V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z",
  clear: "M3.27 5L2 6.27l6.97 6.97L6.5 19h3l1.57-3.66L16.73 21 18 19.73 3.55 5.27 3.27 5zM6 5v.18L8.82 8h2.4l-.72 1.68 2.1 2.1L14.21 8H20V5H6z",
};
