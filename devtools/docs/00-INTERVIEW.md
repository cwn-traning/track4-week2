
# Skin Clinic Management System — User Stories & Requirement Backlog

**Version:** 1.0 (Draft)**Date:** 2026-11-07**Scope:** คลินิกรักษาผิวหน้าขนาดเล็ก รองรับหลายสาขา เว็บไซต์ LINE และ Walk-in**Status:** สำหรับ Business Analyst / Product Owner / Developer ร่วมกันยืนยันก่อนลงมือพัฒนา

> เอกสารนี้เป็นข้อเสนอการวิเคราะห์ความต้องการ ไม่ใช่ข้อเท็จจริงที่ได้รับการยืนยันจากเจ้าของคลินิก กฎเกี่ยวกับแพทย์ เวชระเบียน ความยินยอม และการจัดเก็บข้อมูลต้องตรวจสอบกับผู้รับผิดชอบด้านกฎหมาย/วิชาชีพก่อนใช้งานจริง

## 1. Business Goals

1. ให้ลูกค้าจองบริการผ่าน Website และ LINE ได้ โดยใช้ตารางนัดหมายเดียวกัน
2. บริหารคิวจองล่วงหน้าและ Walk-in ได้ในแต่ละสาขา
3. ใช้ทะเบียนสมาชิกและประวัติบริการส่วนกลางโดยมีการควบคุมสิทธิ์
4. ตรวจสอบสต๊อก วัสดุ สิ้นเปลือง และสินค้าแบบรายสาขาได้
5. ติดตามผลการดำเนินงานผ่านรายงานที่ตรวจสอบตัวเลขย้อนหลังได้

## 2. Actors / Roles

| Role                  | หน้าที่                                                                                                | ขอบเขตข้อมูล                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Customer              | สมัครสมาชิก จอง/ยกเลิก/เลื่อนนัด ดูสถานะคิว                            | เฉพาะข้อมูลของตนเอง                                                   |
| Receptionist          | ลงทะเบียนลูกค้า จัดการนัดหมาย Check-in และ Walk-in                             | สาขาที่ได้รับมอบหมาย                                                 |
| Practitioner / Doctor | เปิดดูข้อมูลการรักษาที่จำเป็น บันทึกการรักษาและติดตามผล | เฉพาะเคสที่ได้รับสิทธิ์                                           |
| Stock Staff           | รับ/เบิก/โอน/ปรับสต๊อก                                                                     | คลังหรือสาขาที่ได้รับสิทธิ์                                   |
| Branch Manager        | ดูคิว สต๊อกและรายงานสาขา อนุมัติรายการตามนโยบาย                  | สาขาที่ดูแล                                                                   |
| Owner / HQ Admin      | จัดการสาขาและรายงานภาพรวม                                                            | ตามสิทธิ์ระดับองค์กร                                                 |
| System Admin          | จัดการผู้ใช้งาน สิทธิ์และการตั้งค่าระบบ                                 | ไม่ควรได้รับสิทธิ์อ่านเวชระเบียนโดยอัตโนมัติ |

## 3. Priorities & Epics

- **P0:** จำเป็นต่อการเปิดใช้งาน MVP
- **P1:** สำคัญสำหรับการดำเนินงานหลังเปิดระบบ
- **P2:** การต่อยอด

| Epic  | Name                          | Priority                                                               |
| ----- | ----------------------------- | ---------------------------------------------------------------------- |
| EP-01 | Member & CRM                  | P0                                                                     |
| EP-02 | Appointment Booking           | P0                                                                     |
| EP-03 | Queue & LINE Notification     | P0                                                                     |
| EP-04 | Treatment / Service History   | P0                                                                     |
| EP-05 | Multi-Branch & Access Control | P0                                                                     |
| EP-06 | Inventory                     | P1 (สินค้าเบิกใช้สำคัญอาจเลื่อนเป็น P0) |
| EP-07 | Reporting                     | P1 (Daily Operations Dashboard อาจเป็น P0)                      |

## 4. Detailed User Stories

### EP-01 Member / CRM

#### US-001 สมัครสมาชิกผ่าน Website หรือ LINE — P0

**As a** Customer **I want to** สมัครสมาชิกผ่านเว็บไซต์หรือ LINE **So that** สามารถจองคิวและติดตามการใช้บริการได้

**Acceptance Criteria**

- กรอกชื่อ เบอร์ติดต่อ และข้อมูลจำเป็นตามนโยบายคลินิก
- ยืนยันการเป็นเจ้าของเบอร์ด้วยกลไก OTP หรือแนวทางที่เทียบเท่า
- ป้องกันบัญชีซ้ำด้วยกติกาที่กำหนดชัดเจน ไม่รวมข้อมูลของคนต่างคนอัตโนมัติ
- ออก Member ID ที่ไม่ซ้ำกัน
- แสดง Privacy Notice และบันทึกหลักฐานการยินยอมเฉพาะวัตถุประสงค์ที่ต้องใช้ความยินยอม

#### US-002 ค้นหาและแก้ไขข้อมูลสมาชิก — P0

**As a** Receptionist **I want to** ค้นหาสมาชิกด้วย Member ID/เบอร์โทร **So that** ลงทะเบียนเข้ารับบริการได้รวดเร็ว

**Acceptance Criteria**

- ค้นหาจากเลขสมาชิกหรือเบอร์โทรที่ได้รับสิทธิ์ใช้งาน
- แก้ไขข้อมูลติดต่อพร้อมบันทึกผู้แก้ไขและเวลา
- จำกัดการแสดงข้อมูลละเอียดอ่อนตามบทบาท
- รองรับโปรไฟล์ผู้รับบริการที่ยังไม่ผูก LINE

#### US-003 เชื่อมบัญชี LINE กับสมาชิกเดิม — P0

**As a** Customer **I want to** เชื่อม LINE กับโปรไฟล์ที่เคยลงทะเบียนหน้าร้าน **So that** รับการแจ้งเตือนคิวและนัดหมายผ่าน LINE ได้

**Acceptance Criteria**

- ต้องยืนยันตัวตนก่อนผูก LINE user ID เข้ากับ Member ID
- ไม่อนุญาตให้ผูก LINE เดียวกับคนละสมาชิกโดยไม่ผ่านขั้นตอนตรวจสอบ
- รองรับการยกเลิกการเชื่อมต่อ
- กำหนดช่องทางแจ้งเตือนสำรองเมื่อไม่สามารถส่ง LINE ได้

#### US-004 ดูประวัติการใช้บริการของสมาชิก — P1

**As a** Customer **I want to** ดูรายการบริการและนัดหมายย้อนหลังของตนเอง **So that** วางแผนครั้งต่อไปได้

**Acceptance Criteria**

- แสดงเฉพาะข้อมูลที่คลินิกอนุญาตให้ลูกค้าเห็น
- ไม่เปิดเผยโน้ตภายในหรือข้อมูลของสมาชิกคนอื่น
- รองรับรายการจากทุกสาขาที่เข้ารับบริการ

### EP-02 Booking

#### US-005 จองผ่าน Website — P0

**As a** Customer **I want to** เลือกสาขา บริการ และเวลาว่าง **So that** นัดหมายได้โดยไม่ต้องโทร

**Acceptance Criteria**

- แสดงสาขา บริการ ระยะเวลาที่ใช้ และเวลาที่จองได้
- ตรวจสอบความพร้อมของห้อง/ผู้ให้บริการ/ทรัพยากรตามรูปแบบที่คลินิกใช้
- บันทึกนัดหมายแบบ atomic เพื่อป้องกัน double booking เมื่อมีหลายคำขอพร้อมกัน
- แจ้ง Booking Reference และสถานะหลังบันทึกสำเร็จ

#### US-006 จองผ่าน LINE — P0

**As a** Customer **I want to** เปิดหน้าจองจาก LINE OA **So that** ไม่ต้องกรอกข้อมูลซ้ำ

**Acceptance Criteria**

- เปิดหน้า booking ที่เชื่อมข้อมูลบัญชี LINE อย่างปลอดภัย
- ใช้ availability และ business rule ชุดเดียวกับ Website
- หากยังไม่เชื่อมสมาชิก ให้ผ่านการยืนยันตัวตนก่อนผูกข้อมูล
- บันทึก channel = LINE และแจ้งผลการจอง

#### US-007 พนักงานสร้างนัดหมายแทนลูกค้า — P0

**As a** Receptionist **I want to** จองให้ลูกค้าที่ติดต่อโทรศัพท์หรือหน้าร้าน **So that** ทุกช่องทางอยู่ในปฏิทินเดียวกัน

**Acceptance Criteria**

- ค้นหาสมาชิกหรือสร้างโปรไฟล์ขั้นต่ำ
- ตรวจสอบเวลาว่างชุดเดียวกันทุกช่องทาง
- ระบุผู้สร้างและที่มาของการนัดหมาย (Staff/Phone/Walk-in)

#### US-008 เลื่อนหรือยกเลิกนัดหมาย — P0

**As a** Customer **I want to** เปลี่ยนหรือยกเลิกนัด **So that** จัดการเวลาตัวเองได้

**Acceptance Criteria**

- บังคับใช้นโยบายช่วงเวลายกเลิก/เลื่อนนัดที่กำหนด
- ปล่อย slot เดิมคืนอย่างถูกต้องเมื่อยกเลิกสำเร็จ
- ป้องกัน race condition ระหว่างเลื่อนนัดกับผู้จองคนอื่น
- เก็บประวัติการเปลี่ยนสถานะและแจ้งเตือนเมื่อตั้งค่าไว้

### EP-03 Queue & LINE

#### US-009 Check-in ลูกค้านัดหมาย — P0

**As a** Receptionist **I want to** ทำ Check-in เมื่อลูกค้ามาถึง **So that** ระบบรู้ว่าลูกค้าพร้อมรับบริการ

**Acceptance Criteria**

- ค้นหาการจองปัจจุบันและยืนยันตัวผู้รับบริการ
- เปลี่ยนสถานะเป็น CheckedIn และสร้าง/เปิดรายการคิวที่เหมาะสม
- ป้องกัน Check-in ซ้ำ

#### US-010 รับลูกค้า Walk-in — P0

**As a** Receptionist **I want to** เพิ่มผู้ที่ไม่มีนัดเข้าคิว **So that** รองรับลูกค้าหน้าร้านได้

**Acceptance Criteria**

- ค้นหาสมาชิกเดิมหรือสร้างรายการสมาชิกแบบขั้นต่ำ
- เลือกสาขาและบริการ ตรวจสอบเวลาคาดว่าจะรับบริการได้
- เพิ่มคิวประเภท WalkIn โดยไม่แย่ง slot ที่จองไว้โดยพลการ
- สามารถแจ้งให้ลูกค้าทราบเมื่อไม่สามารถรับบริการได้

#### US-011 เรียกคิว/อัปเดตสถานะ — P0

**As a** Receptionist **I want to** เรียกคิวและเปลี่ยนสถานะ **So that** จัดลำดับผู้รับบริการได้อย่างมีระบบ

**Acceptance Criteria**

- รองรับ Waiting, Called, InService, Completed, Skipped, Cancelled
- บันทึกเวลาทุก transition และผู้ดำเนินการ
- การข้ามคิวหรือจัดลำดับใหม่ต้องมีสิทธิ์และเหตุผล
- พนักงานในสาขาเห็นสถานะล่าสุดโดยไม่ต้องรีเฟรชเองเมื่อมีเทคโนโลยี real-time

#### US-012 แจ้งเตือน LINE เมื่อใกล้ถึงคิว — P0

**As a** Customer **I want to** ได้รับข้อความเมื่อถึงเวลาที่ต้องเตรียมตัว **So that** ไม่พลาดคิว

**Acceptance Criteria**

- ส่งเฉพาะสมาชิกที่ผูก LINE สำเร็จและอยู่ในเงื่อนไขส่งข้อความ
- แจ้งเตือนจาก queue event หรือ threshold ที่กำหนด (เช่น เหลือ 2 คิว)
- ไม่ส่งซ้ำจากเหตุการณ์เดิม (idempotency)
- บันทึก message ID, delivery attempt, error และ retry ตามนโยบาย
- ข้อความไม่เปิดเผยรายละเอียดการรักษาหรือข้อมูลสุขภาพที่ไม่จำเป็น

#### US-013 แจ้งเตือนนัดหมายล่วงหน้า — P1

**As a** Customer **I want to** ได้รับการเตือนก่อนวันนัด **So that** ลดการลืมนัด

**Acceptance Criteria**

- ตั้งเวลาส่งก่อนนัด เช่น 1 วัน โดยปรับได้
- ยกเลิกงานแจ้งเตือนเก่าหลังเลื่อน/ยกเลิกนัด
- ติดตามความสำเร็จ/ไม่สำเร็จของการส่ง

### EP-04 Treatment / Service History

#### US-014 บันทึกการให้บริการรายครั้ง — P0

**As a** Practitioner **I want to** บันทึกบริการที่ทำจริงใน Visit **So that** มีประวัติใช้ติดตามต่อเนื่อง

**Acceptance Criteria**

- ผูก Visit กับ Member, Branch, Appointment (ถ้ามี), ผู้ให้บริการและเวลา
- บันทึกบริการที่ทำจริงและบันทึกเชิงคลินิกตามสิทธิ์
- มีสถานะ Draft/Finalized และกฎการแก้ไขหลังยืนยัน
- บันทึก Audit Log สำหรับการอ่าน/แก้ไขรายการสำคัญ

#### US-015 ดูประวัติข้ามสาขา — P0

**As a** Authorized Practitioner **I want to** เห็นการรักษาครั้งก่อนข้ามสาขา **So that** ให้บริการอย่างต่อเนื่อง

**Acceptance Criteria**

- ใช้ Member ID กลางและประวัติ Visit กลาง
- ควบคุมสิทธิ์ระดับบทบาทและความเกี่ยวข้องกับเคส
- เก็บ Log เมื่อมีการเปิดดูข้อมูลละเอียดอ่อน

#### US-016 แนบรูป Before/After และติดตามผล — P1

**As a** Practitioner **I want to** แนบภาพผิวหน้าและบันทึกนัดติดตาม **So that** ติดตามผลได้เป็นระบบ

**Acceptance Criteria**

- เก็บภาพในที่จัดเก็บที่ควบคุมสิทธิ์และไม่เปิดสาธารณะ
- บันทึกวัตถุประสงค์/ฐานกฎหมาย/ความยินยอมตามที่เกี่ยวข้อง
- จำกัดผู้ดูและบันทึก Audit Log
- ห้ามนำภาพไปใช้โฆษณาโดยอาศัยความยินยอมด้านการรักษาแทน

### EP-05 Multi-Branch & Authorization

#### US-017 ตั้งค่าหลายสาขา — P0

**As a** Owner **I want to** เพิ่มและตั้งค่าสาขา **So that** บริหารจากระบบเดียว

**Acceptance Criteria**

- แต่ละสาขามีข้อมูลติดต่อ เวลาเปิดปิด และวันหยุดของตัวเอง
- ตั้งค่ารายการบริการและผู้ให้บริการที่พร้อมรับงานแยกสาขาได้
- สมาชิกส่วนกลางและกิจกรรมผูก branch ID ชัดเจน

#### US-018 กำหนดสิทธิ์การใช้งาน — P0

**As a** Admin **I want to** กำหนด Role และ Branch Scope **So that** ป้องกันการเข้าถึงข้อมูลเกินจำเป็น

**Acceptance Criteria**

- แยกสิทธิ์ Staff, Doctor, Stock, Manager, Owner, System Admin
- ตรวจสอบ Authorization ที่ฝั่ง API สำหรับทุกรายการ
- Branch Manager ไม่สามารถดูข้อมูลอีกสาขาเว้นแต่ได้รับสิทธิ์
- System Admin ไม่ได้สิทธิ์อ่านเวชระเบียนโดยอัตโนมัติ
- บันทึกเหตุการณ์เปลี่ยนสิทธิ์

### EP-06 Inventory

#### US-019 จัดการสินค้าและวัสดุ — P1

**As a** Stock Staff **I want to** จัดการ Master Item **So that** บันทึกสินค้าถูกต้อง

**Acceptance Criteria**

- กำหนด SKU, ชื่อสินค้า, หน่วยนับ, ประเภท, จุดสั่งซื้อ และการติดตาม Lot/Expiry
- ป้องกัน SKU ซ้ำตามนโยบายองค์กร
- รองรับการปิดใช้งานแต่ไม่ลบประวัติย้อนหลัง

#### US-020 รับเข้าและเบิกใช้งาน — P1

**As a** Stock Staff **I want to** บันทึก Stock Movement **So that** รู้ยอดคงเหลือจริง

**Acceptance Criteria**

- รองรับ Receive, Issue, Adjustment, Return และ Transfer
- ทุก movement อ้างอิงสาขา คลัง ผู้ดำเนินการและเอกสารอ้างอิง
- ไม่อนุญาตยอดติดลบ ยกเว้นตั้งค่านโยบายอนุญาตโดยชัดเจน
- เก็บประวัติแบบ append-only หรือ ledger ที่ audit ได้

#### US-021 โอนสินค้าระหว่างสาขา — P1

**As a** Branch Manager **I want to** โอนสต๊อกไปอีกสาขา **So that** บริหารสินค้าร่วมกันได้

**Acceptance Criteria**

- สร้างใบโอน ระบุ From/To และจำนวน
- แยก InTransit กับ Received ตามขั้นตอนรับโอน
- ตัดยอดต้นทาง/เพิ่มปลายทางในจุดที่กำหนดชัดเจน
- ป้องกันรับซ้ำและบันทึกผู้ตรวจรับ

#### US-022 แจ้งเตือนใกล้หมด/หมดอายุ — P1

**As a** Branch Manager **I want to** เห็นสินค้าใกล้หมดและใกล้หมดอายุ **So that** สั่งซื้อและลดของเสียได้

**Acceptance Criteria**

- คำนวณ threshold ราย SKU/สาขา
- รายงาน Lot ที่จะหมดอายุตามช่วงวันที่เลือก
- ไม่หยิบสินค้า Lot หมดอายุมาใช้ในการตัดสต๊อกโดยอัตโนมัติ

#### US-023 เชื่อมการใช้วัสดุกับ Visit — P2

**As a** Practitioner **I want to** ระบุวัสดุที่ใช้ในการให้บริการ **So that** หักสต๊อกตามการใช้งานจริง

**Acceptance Criteria**

- บันทึกปริมาณและ Lot ที่ใช้ต่อ Visit
- ป้องกันการหักซ้ำเมื่อกดบันทึกหลายครั้ง
- รองรับยกเลิก/แก้ไขด้วยรายการปรับกลับที่ตรวจสอบได้

### EP-07 Reports

#### US-024 รายงานการจองและคิว — P1

**As a** Branch Manager **I want to** ดูยอดนัดหมาย/Check-in/No-show **So that** ปรับกำลังคนได้

**Acceptance Criteria**

- กรอง Branch, Date Range, Channel, Service
- แยก Booked, Cancelled, Completed, NoShow ตามนิยามเดียวกัน
- ดูจำนวน Walk-in และเวลารอโดยเฉลี่ยเมื่อมีข้อมูลเวลาเพียงพอ

#### US-025 รายงานสมาชิกและการกลับมาใช้บริการ — P1

**As a** Owner **I want to** ดูสมาชิกใหม่และลูกค้าที่กลับมาใช้บริการ **So that** ประเมินการรักษาฐานลูกค้าได้

**Acceptance Criteria**

- ระบุเกณฑ์นับ New vs Returning ให้ชัดเจน
- กรองตามสาขา/ช่วงเวลาโดยไม่นับสมาชิกซ้ำแบบผิดความหมาย
- แสดงผลรวมทั้งองค์กรและแยกสาขา

#### US-026 รายงาน Inventory — P1

**As a** Stock Staff **I want to** ดูยอดคงเหลือและสินค้าเคลื่อนไหว **So that** ตรวจนับและวางแผนเบิกได้

**Acceptance Criteria**

- กรองตาม SKU/Branch/Lot/Date Range
- คำนวณ Opening + In - Out ± Adjustment = Closing
- Export CSV/XLSX ตามสิทธิ์

#### US-027 รายงานรายได้ — P2 (ขึ้นอยู่กับว่ามี Payment Module หรือไม่)

**As a** Owner **I want to** ดูรายได้ตามสาขาและบริการ **So that** ประเมินผลประกอบการได้

**Acceptance Criteria**

- ต้องกำหนดแหล่งข้อมูล Payment/Invoice/Refund ก่อน
- แยกรายได้ที่ชำระจริงจากยอดจอง/ยอดราคาบริการ
- รายงานยอดคืนเงินและส่วนลด
- หากยังไม่มีระบบการเงิน ต้องไม่แสดงยอดจองเป็น 'รายได้จริง'

## 5. Cross-System Flows

### Flow A — Website Booking

Customer → Select Branch → Select Service → Check Slot → Verify Member → Create Appointment → Confirmation → Check-in → Queue → Visit → Completed

### Flow B — LINE Booking

Customer → LINE OA → LIFF / Web Booking → Verify/Link Member → Select Slot → Create Appointment → LINE Confirmation → LINE Reminder → Check-in → Queue Notification

### Flow C — Walk-in

Receptionist → Lookup/Create Member → Select Service → Capacity Check → Create Walk-in Queue → Called → InService → Visit Completed

### Flow D — Inventory

Receive Stock → Lot and Expiry → On-Hand Balance → Issue to Branch/Visit → Movement Ledger → Low Stock Report

## 6. Recommended State Models

**Appointment**: `Pending → Confirmed → CheckedIn → Completed`; อีกทาง `Pending/Confirmed → Cancelled`, `Confirmed → NoShow`; การเลื่อนนัดให้เก็บ reschedule history และนิยาม slot การจองใหม่อย่างชัดเจน

**Queue**: `Waiting → Called → InService → Completed`; ทางเลือก `Waiting/Called → Skipped/Cancelled` และการกลับเข้าคิวขึ้นอยู่กับนโยบาย

**Visit**: `Draft → Finalized`; การแก้ข้อมูลหลัง Finalized ใช้ addendum/เวอร์ชันตามนโยบาย ไม่ลบประวัติเดิม

**Stock Transfer**: `Draft → Approved → InTransit → Received` หรือ `Cancelled` ตามช่วงที่อนุญาต

## 7. Key Business Rules (Proposals)

- **BR-01:** Customer มี Member ID กลาง ทุกสาขาใช้ข้อมูลชุดเดียวกัน
- **BR-02:** Appointment ต้องอ้างอิง Branch ID และ Service ID เสมอ
- **BR-03:** การจองจากทุกช่องทางใช้ Availability Service เดียวกัน และควบคุม concurrent booking
- **BR-04:** Walk-in ไม่ควรยกเลิก slot ลูกค้าที่จองล่วงหน้าโดยอัตโนมัติ
- **BR-05:** Queue Number เป็นเลขต่อสาขาต่อวัน (เสนอ; รอยืนยัน)
- **BR-06:** LINE Notification ส่งเฉพาะสมาชิกที่เชื่อม LINE และส่งได้ตามข้อกำหนดของแพลตฟอร์ม
- **BR-07:** เวชระเบียน/ภาพรักษาถูกจำกัดสิทธิ์และมี audit access
- **BR-08:** Stock balance แยกราย Branch + Location + SKU + Lot ตามความจำเป็น
- **BR-09:** การโอนสาขาใช้ transfer transaction ไม่แก้ยอดปลายทางโดยตรง
- **BR-10:** รายงานต้องนิยาม Metrics และ Timezone (Asia/Bangkok) ให้สอดคล้องกัน
- **BR-11:** No-show ถูกกำหนดเมื่อพ้นช่วงเวลา grace period ตามนโยบาย ไม่ใช่เมื่อไม่ Check-in ทันที
- **BR-12:** การสื่อสารผ่าน LINE ไม่รับประกันว่าจะส่งถึงทุกกรณี ต้องมี fallback/กระบวนการเจ้าหน้าที่

## 8. Domain/Data Model (Logical)

- `branches`, `branch_business_hours`, `branch_holidays`
- `users`, `roles`, `user_branch_assignments`, `permissions`
- `members`, `member_contacts`, `member_line_accounts`, `consent_records`
- `services`, `branch_services`, `practitioners`, `practitioner_schedules`, `rooms`
- `appointments`, `appointment_status_histories`, `booking_resources`
- `queues`, `queue_events`, `notification_outbox`, `notification_attempts`
- `visits`, `visit_services`, `treatment_notes`, `visit_media`, `audit_logs`
- `items`, `item_units`, `stock_lots`, `stock_locations`, `stock_movements`, `stock_transfers`, `stock_transfer_lines`
- Optional finance: `invoices`, `payments`, `refunds`, `discounts`

**Design note:** แยก `appointment` (นัดหมาย), `queue` (รอรับบริการ), `visit` (การให้บริการจริง) เป็นคนละ aggregate; ลูกค้า Walk-in สามารถมี queue/visit โดยไม่มี appointment ล่วงหน้า

## 9. Security & Non-functional Requirements

- Authentication + role/branch-scoped authorization ที่ backend (ไม่อาศัยซ่อนเมนูอย่างเดียว)
- Sensitive data encryption in transit/at rest, key management, backups, recovery drills
- Access audit สำหรับเวชระเบียน/ภาพ/ข้อมูลสมาชิกและการเปลี่ยนแปลงสิทธิ์
- Data minimization, purpose limitation, data-retention/deletion policy, incident response
- ตรวจสอบข้อกำหนด PDPA/ข้อมูลสุขภาพและกฎเวชระเบียนที่ใช้บังคับกับคลินิกจริง
- LINE webhook signature verification, idempotent event handling, asynchronous queue/retry; หลีกเลี่ยงเผยข้อมูลสุขภาพผ่านข้อความแจ้งเตือน
- Slot locking/transaction constraints ป้องกัน duplicate appointment
- Pagination, filtering, observability และ alerting ของ booking/notification errors
- RPO/RTO, SLA, performance targets และ retention period ต้องยืนยันก่อน implement

## 10. MVP Releases

| Phase | Scope                                                                                                                                                      | Objective                                                      |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| MVP 1 | Branch setup, roles, member registry, Website/LINE booking, staff bookings, Walk-in, Check-in, queue, basic LINE notifications, visit history, basic audit | รับลูกค้าได้จริงครบกระบวนการ       |
| MVP 2 | Inventory, lot/expiry, transfers, reminders, daily operations report, export                                                                               | คุมสินค้าและดูการดำเนินงาน           |
| MVP 3 | Before/after photo, richer analytics, visit material consumption, invoice/payment/revenue report (ถ้าต้องการ)                                    | เพิ่มประสิทธิภาพและบริหารธุรกิจ |

## 11. UAT Scenarios (High Impact)

1. ลูกค้า Website กับ LINE จอง slot เดียวกันพร้อมกัน → ต้องสำเร็จเพียงรายการตาม capacity จริง
2. ลูกค้าเคยมา Walk-in แล้วภายหลังเชื่อม LINE → ประวัติเดิมยังอยู่และไม่สร้างบัญชีซ้ำ
3. ลูกค้าจองสาขา A แต่มารักษาสาขา B → สิทธิ์ผู้ใช้และการย้ายบริการต้องเป็นไปตามนโยบาย
4. พนักงานสาขา A พยายามอ่านข้อมูลสต๊อก B → ได้ผลตาม permission/branch scope
5. LINE webhook ส่งซ้ำ → ไม่สร้าง Booking/Notification ซ้ำ
6. ลูกค้าบล็อก LINE OA → ระบบเก็บ failure และเจ้าหน้าที่ทราบช่องทางติดต่อตามนโยบาย
7. โอน Lot จากสาขา A ไป B แต่ยังไม่ตรวจรับ → จำนวนปลายทางยังไม่ถูกนับเป็น available
8. แก้ไขเวชระเบียนหลัง Finalized → ไม่ลบ audit และไม่แทนที่ประวัติแบบไร้ร่องรอย
9. ยกเลิกนัดก่อนถึงวัน → ไม่มี reminder ที่ล้าสมัยส่งออก
10. Dashboard ทุกสาขา → metric รวมไม่ double count ลูกค้าคนเดียว

## 12. Open Questions for Product Owner / Clinic

1. คลินิกมีแพทย์/ผู้ให้บริการกี่คนต่อสาขา และบริการใดต้องผูกแพทย์หรือห้อง?
2. การนัดหมายให้ยืนยันอัตโนมัติหรือพนักงานอนุมัติ?
3. Walk-in เข้าคิวตามเวลา หรือมี priority จากการจองและชนิดบริการ?
4. การเรียกคิวเป็นแบบเลขคิวต่อสาขาต่อวันหรือแยกประเภทบริการ?
5. LINE ใช้ OA เดียวกันทุกสาขาหรือแยก OA? มีงบส่งข้อความเท่าไร?
6. สมาชิกต้องรองรับบุคคลที่ไม่มี LINE/ไม่มีสมาร์ตโฟนหรือไม่?
7. ต้องการบันทึกข้อมูลสุขภาพ/คำวินิจฉัย/รูป Before-After ลึกระดับใด?
8. สต๊อกนับสินค้าขายหน้าร้าน วัสดุใช้รักษา ยา และอุปกรณ์หรือไม่?
9. ต้องการขายคอร์ส/แพ็กเกจ/เครดิตคงเหลือและชำระเงินหรือไม่?
10. Report 'รายได้' จะดึงข้อมูลจาก POS/บัญชีภายนอกหรือสร้าง Payment Module ภายใน?
11. ต้องส่งแจ้งเตือนกี่นาทีก่อนถึงคิว และจะวัด ETA อย่างไร?
12. มีข้อกำหนดการคงเก็บเวชระเบียน ภาพ และการขอถอนความยินยอมอย่างไร?

## 13. Definition of Done (Cross-cutting)

- Acceptance Criteria ผ่าน Test/UAT ครบ
- Role/branch authorization มี automated negative tests
- Concurrent booking / event duplication มี integration tests
- Audit event สำหรับข้อมูลสำคัญครบ
- Error messages และ retry policy พร้อมใช้
- API documentation, monitoring, backup/restore procedure และ deployment rollback มีผู้รับผิดชอบ
- ไม่มี sensitive data หลุดเข้า log, notification หรือ report export โดยไม่จำเป็น

## 14. External Integration References

- LINE Messaging API webhook: https://developers.line.biz/en/docs/messaging-api/receiving-messages/
- LINE Messaging API reference: https://developers.line.biz/en/reference/messaging-api/
- LINE Developers Thailand: https://linedevth.line.me/th/

**Note:** การส่งข้อความผ่าน LINE ต้องตรวจสอบความสามารถและเงื่อนไข channel/การรับข้อความ/แพ็กเกจปัจจุบันก่อนพัฒนา โดยเฉพาะกรณีผู้ใช้บล็อก OA หรือไม่มีสิทธิ์รับข้อความ
