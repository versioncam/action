import { clip } from "versioncam";

/**
 * Add a book: fill in the form, press the button, see the book at the top of
 * the list.
 *
 * The button is found by its role and its name, the way a person would
 * describe it. The two acceptance branches of this repository lean on that:
 * rename the button and this clip fails at the click, which the pull request
 * comment names; change the words around the button and the clip still
 * passes, and the new words are in the video.
 */
export default clip("first", { title: "Add a book", seed: 7 }, async (s) => {
  await s.open("/");
  s.caption("Add a book to the reading list");
  await s.hold(600);

  await s.typeInto(s.byLabel("Title"), "The Left Hand of Darkness");
  await s.hold(150);
  await s.typeInto(s.byLabel("Author"), "Ursula K. Le Guin");
  await s.hold(300);

  await s.click(s.byRole("button", { name: "Add book" }));
  await s.settle({ label: "book added" });
  await s.hold(300);

  await s.highlight(s.byTestId("book-6"), "ring", { for: 1600 });
  await s.hold(1700);
});
