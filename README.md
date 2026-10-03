# Guess Market - Exercise 4 (Web client)

Submitters: Shady Aboarya (325556835), Abed Alqader Wattad (213726094).

A web client for the Guess Market server of Exercise 3 ([GuessMarket-EX3](https://github.com/Shady-ab/GuessMarket-EX3)).
It uses exactly the same HTTP API as the JavaFX client; the server and its setup are not changed.

The full readme (how to run, design, work with AI tools) is in `readme.docx` / `readme.pdf`, generated from `readme.html` by `make-readme.ps1`.

## Run

1. Start Tomcat with `GuessMarket.war` (Exercise 3) at `http://localhost:8080/GuessMarket`.
2. Run `run.bat` (needs only Node.js; there are no npm dependencies).
3. Open `http://localhost:3000` (the browser opens automatically).

## Files

- `server.js` - serves `public/` and forwards `/GuessMarket/...` to the Tomcat server (built-in Node modules only).
- `public/index.html`, `public/app.js`, `public/app.css` - the web client (plain HTML, CSS and JavaScript).
- `package-submission.bat` - creates the submission zip.
