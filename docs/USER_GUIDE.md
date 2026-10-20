# User Guide

**Finding things.** The search box at the top of every page finds jobs, customers, quotations, POs, heat numbers, lots, drawings, programs, machines and people.

**Barcodes and QR codes.**
- With a USB or Bluetooth scanner: click the search box and scan. Scanning a traveller QR code opens the job or operation directly.
- On tablets with a camera: tap the scan icon.

**Signing approvals.** Approvals that carry responsibility (releases, first-off, dispositions, exceptions) ask you to **re-enter your password**. The screen shows exactly what you are confirming, and your signature is recorded with that statement.

---

## Machine operators — *My work*
When you sign in you see **My work**: your current job, operations ready to start, what's next, items awaiting inspection, holds and your recent history.

Open an operation and follow the numbered steps:
1. **Review the drawing.** Open it and check the revision. If it shows *Do not use*, stop and call your supervisor.
2. **Read the work instructions** and any attached setup sheets.
3. **Confirm the material.** Select or scan the lot. Only released lots allocated to this job can be used; the heat number is shown.
4. **Confirm the CNC program.** Check the program number and revision, and optionally the checksum shown on the machine. Only the current released revision can be downloaded.
5. **Start setup**, then **Finish setup** when the machine is set.
6. **First-off.** If required, production stays blocked until an inspector approves the first part. You'll see *Awaiting first-off*.
7. **Start production**, then **Stop and record quantities**: good, rejected and scrapped. If you reject or scrap parts, raise a non-conformance from the same screen.
8. **Downtime.** Record a stoppage with a reason (tool breakage, breakdown, waiting for material…), then end it.
9. **Notes and help.** Add notes, report an issue, or **Request assistance**, which notifies the supervisors.
10. **Hold.** Place the operation on hold with a reason if something is wrong.
11. **Submit for inspection**, if required.
12. **Sign off.** All quantities must be accounted for; if you made fewer parts than planned, give a reason. After sign-off, the next operation becomes ready and its operator is notified.

**Why is a button blocked?** The **Gates** panel lists every check (previous operation complete, material released, program released, you are qualified, machine available, no holds, first-off approved) and tells you what is missing.

---

## Production manager / planner
- **Jobs.** Jobs are created from verified customer POs (*Customer orders*). On the job:
  - **Authorise** it so material can be bought and production released.
  - Build the **Route**: add operations, choose machines, programs, inspection plans and required competencies; assign operators; set dependencies (sequential by default; tick *allow parallel* for independent operations).
  - Split operations into batches, repeat or reorder them, then **Release route**.
- **Revision changes.** When a drawing or program revision is released, affected open operations are flagged **Review required**. Open the operation and **Clear review**, choosing whether it moves to the new revision. Nothing is switched automatically.
- **Planning → Schedule board.**
  - Drag operations onto machine rows.
  - Every placement is checked for machine capability, overlaps, maintenance windows, dependencies and program compatibility.
  - Rescheduling asks for a reason, and every change is logged.
  - Planned and actual times are shown separately.
- **Planning → Dashboard.** Late and at-risk jobs, waiting material or programming, workloads by machine and operator, and maintenance restrictions.
- **Gate exceptions.** With authority, you can record a signed, justified exception for one operation (dependency, material, operator, first-off or drawing gates only).

## CNC programmer
**CNC programs → New program.** Choose the part, compatible machines and the first revision file. Then:
1. **Submit** the revision.
2. **Record verification**: simulated, proved out, or not required.
3. A quality manager or an authorised approver who is **not you** **approves** and **releases** it.

New revisions never overwrite earlier ones. Released revisions keep their file and checksum. Every download and denied access is logged.

## Quality inspector
- **Quality → Inspections** lists open inspections. First-off inspections block production, so do these first.
- **Entering results.**
  - Enter each measured value and choose the instrument. Instruments out of calibration cannot be selected.
  - The screen shows in/out of tolerance as you type; the server makes the final decision.
  - A blank value is **missing**, never a pass.
- **Completing.** **Pass** needs every characteristic and sample recorded and in tolerance. First-off and final inspections are signed.
- **Failing.** **Fail** automatically raises a non-conformance and puts the work on hold.
- **Independence.** You cannot inspect or approve work you set up or produced.
- **Incoming material.** On the lot page: verify the certificate (the heat number must match), then pass or fail the incoming inspection.

## Quality manager
- **Final release** (*Jobs → Quality → Prepare final release*).
  - Review the system checks: operations complete, first-offs approved, inspections passed, final accepted quantity, no open NCRs or holds, material traceable to released and certified lots, only approved programs used, drawing revision current.
  - Tick the checklist items, including customer requirements.
  - Enter the quantity and **sign**. A Certificate of Conformity PDF is generated.
  - You cannot release parts you worked on.
- **Non-conformances.**
  1. Record containment and root cause.
  2. Approve the disposition (signed): rework or repair create rework operations; use-as-is and repair need a customer concession reference.
  3. Holds are released when appropriate.
  4. After rework, the part is reinspected.
  5. **Close** the NCR. Raise corrective actions and verify their effectiveness (by someone other than the owner).
- **Material release.** Release lots only when the inspection has passed, the certificate is verified and the BoxHero stock-in is confirmed.
- **Documents, programs, inspection plans.** Approve and release them (signed).
- **Instruments.** Record calibrations. If an instrument is found **out of tolerance**, every result measured with it since the last good calibration is flagged for review.

## Sales and quotations
1. **Enquiries.**
   - Create one, or use **Email inbox**: import an `.eml` file or receive emails automatically (if configured), then create or link an enquiry.
   - Customer files are kept as originals. Drawings can be registered as controlled documents.
2. **Quotation.**
   - Add lines with full costing: material + wastage, programming, setup per batch, operations (setup and cycle times × rate), labour, tooling, consumables, subcontract, finishing, inspection, certification, packaging, delivery, and margin.
   - A live preview shows unit cost and price.
   - **Submit for review**. A manager approves it (signed). Then **mark as sent**; this locks the revision and stores the PDF.
   - Changes need a **new revision**, and old revisions are kept.
3. **Customer response.** Either way, the acceptance must be confirmed by a second step before a job can be created.
   - **Online (mutual acceptance).** Sending a quotation creates a secure **customer link**, included in the quotation email. The success message shows it too, so you can paste it into your own email. On that page the customer reviews the exact revision and either:
     - **accepts**, giving their name, position, email and PO number, attaching their PO if they like, and confirming they are authorised;
     - **asks for changes**, which notifies you and adds their comment to the quotation, with the link staying open; or
     - **declines**.

     An online acceptance arrives as **Accepted online** on the quotation. Someone with permission to verify acceptances then **countersigns** it with their password. That confirms the order and emails the customer a **signed order acceptance PDF** showing both signatures. Sending a new revision, or using **Replace customer link**, stops the old link working. Links stop accepting responses when the quotation expires.
   - **By email or phone.** Record the acceptance with evidence (the email, the PO) or a reference. A **different person verifies** it before it counts as accepted.
4. **Customer orders.**
   - Register the PO (attach the document).
   - **Verify** it against the accepted quotation (contract review, signed).
   - **Create job.** The job number is permanent.

## Purchasing
1. **Requisitions** come from authorised jobs. Raise **purchase orders** only to approved suppliers. Another person **approves** the PO, then you **mark it sent**.
2. **Receive goods** against the PO. Enter the heat or cast number (required), and the BoxHero location if the stock is tracked there. Each received line becomes a **lot**, *awaiting inspection*: received material is **not** usable until it is inspected, its certificate is verified, and it is released.
3. **Certificates.** Upload them on the lot page.
4. **Materials → BoxHero** shows the integration status and any stock movements needing attention.

## Dispatch
1. **Dispatch → Ready to dispatch** shows released quantities.
2. **Prepare dispatch.** Only released, accepted, non-held quantity can be included; partial deliveries are allowed.
3. **Confirm dispatch** generates the delivery note. You can also print the packing list.
4. **Record delivery** (upload the proof of delivery).

## Management and auditors
- **Dashboard.** Order book, WIP, quotation pipeline, on-time delivery, scrap and rework rates, first-pass yield, machine utilisation (definitions in `KPI_DEFINITIONS.md`), late and at-risk jobs, quality items.
- **Reports.** Filter and export to CSV.
- **Traceability.**
  - Search a job, heat number, lot, serial or batch, or a delivery note, to see the full chain forwards and backwards.
  - Download the traceability PDF.
- **Auditors.** You have read-only access, including the audit trail. You can't see commercial data.
