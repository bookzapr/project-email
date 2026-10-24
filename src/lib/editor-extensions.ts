// ส่วนเสริมของตัวแก้ไขอีเมล — ทุกการจัดรูปแบบออกมาเป็น inline style เพื่อให้แสดงผลตรงกันใน Gmail/Outlook
import { Extension, type CommandProps } from "@tiptap/core";

const INDENT_PX = 40;
const MAX_INDENT = 8;
const INDENT_TYPES = ["paragraph", "heading"];

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    indent: {
      indent: () => ReturnType;
      outdent: () => ReturnType;
    };
  }
}

/** เพิ่ม/ลดการเยื้องย่อหน้า (ในรายการ = เลื่อนระดับรายการ) */
export const Indent = Extension.create({
  name: "indent",

  addGlobalAttributes() {
    return [
      {
        types: INDENT_TYPES,
        attributes: {
          indent: {
            default: 0,
            parseHTML: (el) => Math.min(MAX_INDENT, Math.round((parseInt(el.style.marginLeft, 10) || 0) / INDENT_PX)),
            renderHTML: (attrs) => (attrs.indent ? { style: `margin-left: ${attrs.indent * INDENT_PX}px` } : {}),
          },
        },
      },
    ];
  },

  addCommands() {
    const shift =
      (delta: number) =>
      ({ tr, state, dispatch }: CommandProps) => {
        let changed = false;
        const { from, to } = state.selection;
        state.doc.nodesBetween(from, to, (node, pos) => {
          if (!INDENT_TYPES.includes(node.type.name)) return true;
          const next = Math.max(0, Math.min(MAX_INDENT, (node.attrs.indent ?? 0) + delta));
          if (next !== node.attrs.indent) {
            if (dispatch) tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next });
            changed = true;
          }
          return false;
        });
        return changed;
      };

    return {
      indent:
        () =>
        (props) =>
          props.editor.isActive("listItem") ? props.commands.sinkListItem("listItem") : shift(1)(props),
      outdent:
        () =>
        (props) =>
          props.editor.isActive("listItem") ? props.commands.liftListItem("listItem") : shift(-1)(props),
    };
  },

  addKeyboardShortcuts() {
    return {
      Tab: () => this.editor.commands.indent(),
      "Shift-Tab": () => this.editor.commands.outdent(),
    };
  },
});

// ---------- ตัวเลือกในแถบเครื่องมือ ----------

export const FONTS: { label: string; value: string | null }[] = [
  { label: "ค่าเริ่มต้น (Tahoma)", value: null },
  { label: "Sans Serif", value: "Arial, Helvetica, sans-serif" },
  { label: "Serif", value: "'Times New Roman', Times, serif" },
  { label: "Fixed Width", value: "'Courier New', Courier, monospace" },
  { label: "Wide", value: "'Arial Black', Arial, sans-serif" },
  { label: "Narrow", value: "'Arial Narrow', Arial, sans-serif" },
  { label: "Comic Sans MS", value: "'Comic Sans MS', cursive, sans-serif" },
  { label: "Garamond", value: "Garamond, 'Times New Roman', serif" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Trebuchet MS", value: "'Trebuchet MS', sans-serif" },
  { label: "Verdana", value: "Verdana, Geneva, sans-serif" },
  { label: "Leelawadee (ไทย)", value: "'Leelawadee UI', Leelawadee, Tahoma, sans-serif" },
  { label: "Angsana New (ไทย)", value: "'Angsana New', 'Browallia New', serif" },
  { label: "Cordia New (ไทย)", value: "'Cordia New', 'Browallia New', sans-serif" },
];

export const SIZES: { label: string; value: string | null }[] = [
  { label: "เล็ก", value: "12px" },
  { label: "ปกติ", value: null },
  { label: "ใหญ่", value: "20px" },
  { label: "ใหญ่มาก", value: "28px" },
];

// พาเลตสีแบบ Gmail: แถวบนเป็นเทา ตามด้วยสีหลัก และเฉดอ่อน/เข้ม
export const COLORS = [
  "#000000", "#444444", "#666666", "#999999", "#cccccc", "#eeeeee", "#f3f3f3", "#ffffff",
  "#ff0000", "#ff9900", "#ffff00", "#00ff00", "#00ffff", "#0000ff", "#9900ff", "#ff00ff",
  "#f4cccc", "#fce5cd", "#fff2cc", "#d9ead3", "#d0e0e3", "#cfe2f3", "#d9d2e9", "#ead1dc",
  "#ea9999", "#f9cb9c", "#ffe599", "#b6d7a8", "#a2c4c9", "#9fc5e8", "#b4a7d6", "#d5a6bd",
  "#cc0000", "#e69138", "#f1c232", "#6aa84f", "#45818e", "#3d85c6", "#674ea7", "#a64d79",
  "#990000", "#b45f06", "#bf9000", "#38761d", "#134f5c", "#0b5394", "#351c75", "#741b47",
];
