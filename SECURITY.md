# Security policy

## Supported versions

| Version | Supported |
| --- | --- |
| 1.0.x | yes |

## Reporting a vulnerability

Open a private security advisory on the repository, or email the owner at
kdbn121@gmail.com. Please do not open a public issue for a vulnerability before it
has been fixed.

Report what the problem is, how to reproduce it and what an attacker would gain.

## What this skill does with your files

- Everything runs on your machine. The similarity engine and the local audit make no
  network calls at all.
- The live pattern scripts make one outbound request, to
  `https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing`, to read the public
  pattern list. The request carries no document text.
- The live checker script only prepares paste ready chunks in your own output folder.
  It never uploads your document anywhere. The checkers are run by hand, in a
  browser, on a machine you control, so the decision to send text to a third party
  service stays yours.
- No telemetry, no analytics, no crash reporting and no account.

## Third party services

The skill names several free checkers. None of them is contacted by the code. The
manual commands are in `references/live-checkers.md` and each one says what the
service does with the text you paste into it.

## Out of scope

- A checker score that you expected and did not get. The classifiers are private
  and move without notice, and no score can be guaranteed.
- Text that a checker flags after you have already sent it to that checker.
