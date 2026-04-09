export { createNotesDb, closeNotesDb, type NotesDb } from "./connection.js";
export {
  saveNote,
  getNote,
  listNotes,
  searchNotes,
  updateNote,
  deleteNote,
  type Note,
  type NoteSearchResult,
} from "./crud.js";
