/**
 * The test app: a form, a list and a dialog, and nothing clever.
 *
 * Every control has a stable accessible name, because the clip finds the
 * button the way a person would describe it: the button called "Add book".
 * Nothing here waits on the network or a timer, so the page is done the
 * moment it has drawn.
 */

const books = [
  { id: 1, title: "Middlemarch", author: "George Eliot" },
  { id: 2, title: "The Remains of the Day", author: "Kazuo Ishiguro" },
  { id: 3, title: "Invisible Cities", author: "Italo Calvino" },
  { id: 4, title: "A Wizard of Earthsea", author: "Ursula K. Le Guin" },
  { id: 5, title: "Things Fall Apart", author: "Chinua Achebe" },
];
let nextId = 6;
let pending = null;

const list = document.getElementById("books");
const form = document.getElementById("add-form");
const status = document.getElementById("form-status");
const dialog = document.getElementById("remove");
const detail = document.getElementById("remove-detail");

function render() {
  list.replaceChildren(
    ...books.map((book) => {
      const item = document.createElement("li");
      item.dataset.testid = `book-${book.id}`;

      const title = document.createElement("span");
      title.className = "title";
      title.textContent = book.title;

      const author = document.createElement("span");
      author.className = "author";
      author.textContent = `by ${book.author}`;

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "quiet";
      remove.textContent = "Remove";
      remove.setAttribute("aria-label", `Remove ${book.title}`);
      remove.addEventListener("click", () => {
        pending = book;
        detail.textContent = `${book.title}, by ${book.author}, leaves the list.`;
        dialog.showModal();
      });

      item.append(title, author, remove);
      return item;
    }),
  );
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const title = form.elements.title.value.trim();
  const author = form.elements.author.value.trim();
  if (!title || !author) {
    status.textContent = "A book needs a title and an author.";
    return;
  }
  books.unshift({ id: nextId++, title, author });
  render();
  form.reset();
  status.textContent = `Added ${title}.`;
});

dialog.addEventListener("close", () => {
  if (dialog.returnValue === "remove" && pending) {
    books.splice(books.indexOf(pending), 1);
    status.textContent = `Removed ${pending.title}.`;
    render();
  }
  pending = null;
});

render();
