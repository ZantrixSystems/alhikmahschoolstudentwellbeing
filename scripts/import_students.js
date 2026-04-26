const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://neondb_owner:npg_DKbx84FulAXN@ep-flat-rain-abpiu07h-pooler.eu-west-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require' });

const students = [
  ['AHB24007','Eisa','Nowshard'],['AHB24018','Yusuf','Ali'],['AHB24040','Talha','Ramzan'],['AHB23021','Haris','Iqbal'],['AHB24009','Hassan','Asif'],
  ['AHB24020','Abdul Muhsin','Miah'],['AHB22022','Talha','Ahmed'],['AHB24037','Musab','Hashmee'],['AHB21004','Ashaz Ur-Rehman','Hashmee'],['AHB24004','Muhammad Abdullah','Hussain'],
  ['AHB21008','Ibrahim','Hassan'],['AHB25001','Sufyan','Wardak'],['AHB23016','Umayr','Ibn-Fiaz'],['AHB23019','Zakariyah','Sikdar'],['AHB22006','Mohammed Faizaan','Rahman Choudhury'],
  ['AHB24012','Mohammed Jillani','Ahmed'],['AHB25010','Zayan','Ahmed'],['AHB24017','Mohamed Tariq','Jaber'],['AHB22018','Suhaiyb Samin','Miah Dina'],['AHB23006','Ayaan Tajwar','Quazi'],
  ['AHB22002','Ayyub Ahmed','Ali'],['AHB25002','Humayd','Khan'],['AHB21006','Hamza (Khan)','Muhammad'],['AHB24005','Abdurrahman','Malik'],['AHB21015','Salahuddin','Ellahi'],
  ['AHB23020','Zayd','Amiry'],['AHB25027','Yusuf','Ibrahim'],['AHB24028','Kaysan','Choudhury'],['AHB22021','Tahminur','Rahman'],['AHB22004','Fadil','Lone'],
  ['AHB20015','Nasif Hussain','Lone'],['AHB24016','Suleiman','Miah'],['AHB24006','Ayaan','Achtar'],['AHB24035','Musa','Miah'],['AHB23014','Muhammad Yahya','Irfan'],
  ['AHB21010','Mohammed Yakub','Khan'],['AHB24033','Muhammad','Zayan'],['AHB21019','Taohid','Tafsirul Islam'],['AHB22020','Tahmid','Hussain'],['AHB25028','Ishaq','Ahmed'],
  ['AHB22015','Ryhan','Hussain'],['AHB23008','Isam','Ali Khan'],['AHB22007','Mohammed Habibul','Islam'],['AHB24026','Ibrahim Bashir','Gohar'],['AHB23001','Abdullah','Azom'],
  ['AHB25024','Adam Yahya','Alom'],['AHB21005','Danyaal Abdurrahman','Choudhury'],['AHB24027','Ismail','Ahmed'],['AHB23007','Ibrahim','Shazad'],['AHB21013','Rafi','Billa'],
  ['AHB22023','Yasir','Ahmed'],['AHB21014','Redoan','Islam'],['AHB22001','Arafat','Ahmed'],['AHB24021','Abdurrahman Jibreel Ibn','Jalal Aabideen'],['AHB24001','Aadam','Riaz'],
  ['AHB21020','Wahid','Uddin'],['AHB19006','Mohammed','Fahim'],['AHB24031','Mohsin','Islam'],['AHB21011','Mohammed Yusuf','Uddin'],['AHB23003','Abdurrahman Chowdhury','Jannat'],
  ['AHB25031','Muhammad','Ahmed'],['AHB23015','Rishad Uddin','Bhuiyan'],['AHB24014','Salahudeen','Ali'],['AHB23012','Muhammad Ibrahim','Uddin'],['AHB22017','Sahil','Dadzadeh'],
  ['AHB22019','Sulaimaan','Kalam'],['AHB21012','Omar','Farooqi'],['AHB24022','Adyan','Hasan'],['AHB24032','Muhammad','Alqamah'],['AHB23018','Zakariya Husain','Ali Soyada'],
  ['AHB24011','Ibrahim','Haque'],['AHB21016','Shah Yaqoob','Hussain'],['AHB22005','Mohammed','Madyan'],['AHB21002','Ahmed Ali','Talat'],['AHB24019','Yusuf','Pashtoonyar'],
  ['AHB24002','Abeeduz','Zaman'],['AHB24039','Saleem','Ijaz'],['AHB23005','Armaan','Ijaz'],['AHB24043','Zakariya','Asif'],['AHB23017','Yaseen','Hussain'],
  ['AHB24041','Umar-Farouk Amaan','Mumuni'],['AHB22013','Mutari Adil','Mumuni'],['AHB21007','Humza','Bilal Mahmood'],['AHB24025','Ahnaf','Amin'],['AHB24010','Hussain','Siddique'],
  ['AHB23002','Abdulrehman Al Sudais','Shafqat'],['AHB21018','Talha Muhammed','Miah'],['AHB22014','Okasha Iqbal','Patel'],['AHB24008','Harris','Omar'],['AHB24024','Ahmed','Hazrat'],
  ['AHB22009','Muhammad Aftab','Hazrat'],['AHB22011','Muhammad Zakariyaa','Hossen Baccus'],['AHB25003','Ibrahim','Nasery'],['AHB24042','Uzair','Rahman'],['AHB23004','Adyan','Al-Yameen'],
  ['AHB24038','Sahir','Abbas'],['AHB22016','Safiy','Bin Abbas'],['AHB24015','Shazad','Mehmood'],['AHB19004','Inayat','Hussain'],['AHB23011','Mohammed Sadikur','Rahman'],
  ['AHB24036','Musa nasar','Hussain'],['AHB22003','Esa','Meer'],['AHB24003','Abdul','Sami'],['AHB25025','Atik Ullah Shihab','Khan'],['AHB21022','Nahyaan Iqbal','Choudhury'],
  ['AHB21009','Moeez','Imran'],['AHB19005','Minhajur','Rahman Meju'],['AHB25014','Ismaeel Yahya','Rickwood'],['AHB25017','Dawud','Ali'],['AHB25022','Yaqub','Khan'],
  ['AHB25016','Mohamed Siyaam','Khushal'],['AHB25033','Mohammad Musab','Reza'],['AHB25012','Junaid','Chowdhury'],['AHB25030','Farjan Anwara','Sultan'],['AHB21023','Talha','Choudhury'],
  ['AHB25026','Musa Ibn','Rashid'],['AHB25019','Rayyan','Miah'],['AHB25037','Sharif Mahdi','Khan'],['AHB23023','Muhammad','Zakariyya'],['AHB25038','Mohammad Jobaer','Hossain'],
  ['AHB25039','Mohammed Rayyan','Ali'],['AHB25035','Isman','Uddin'],['AHB25007','Mohammed Jakaria','Majed'],['AHB25034','Umar','Chowdhury'],['AHB24044','Hassan Mushtaq','Tahir'],
  ['AHB25023','Mohsin','Gulam'],['AHB23024','Daniyal','Khan'],['AHB25055','Ibraheem','Akhtar'],['AHB25004','Syed Mihran','Ahmed'],['AHB25044','Rashid','Ahmed'],
  ['AHB24045','Ayan','Ahmad'],['AHB25018','Salahudeen','Suhail'],['AHB25045','Rafi','Ahmed'],['AHB23026','Yunus','Hasan'],['AHB25036','Tahsinur','Rahman'],
  ['AHB25052','Usman Ariz','Miah'],['AHB24046','Ismaeel Usman','Mahmood'],['AHB24049','Musa','Ali'],['AHB25054','Muhammad Abdullah','Shoaib'],['AHB25050','Subhaan','Ullah'],
  ['AHB24048','Sarmad','Bashir'],['AHB23029','Mohammad Sahad','Ali'],['AHB25057','Muhammad Luqman','Ali'],['AHB26007','Aadil','Mahmood'],['AHB26001','Muhammad Adyan','Ahmed'],
  ['AHB26002','Mountakin','ahmed'],['AHB26008','Yameen','Moula'],['AHB26004','Mohammed','Aayan'],['AHB26018','Adian Ahmed','Chowdhury'],['AHB26011','Kiyaan Idris','Miah'],
  ['AHB26005','Mohammed','Hassan Siddique'],['AHB26012','Aadam','Ali'],['AHB26022','Yaheya Thayib','Ahmed'],['AHB26025','Subhan','Zohaib'],['AHB24054','Zayn Kazaz','Kazazo'],
  ['AHB24056','Musa','Ahmed'],['AHB24055','Zackariya','Amir'],['AHB26020','Muhammad','Ikrimah'],['AHB26016','Yahya','Usman'],['AHB26026','Esa','Sadiq'],
  ['AHB26009','Muaadh','Ahmed'],['AHB26010','Arham ibaad','Khan'],['AHB24058','Abdul','Qadir'],
];

client.connect().then(async () => {
  let inserted = 0, skipped = 0;
  for (const [code, first, last] of students) {
    const existing = await client.query('SELECT id FROM students WHERE student_code = $1', [code]);
    if (existing.rows.length) { skipped++; continue; }
    await client.query(
      'INSERT INTO students (student_code, first_name, last_name, current_status, created_by, updated_by) VALUES ($1, $2, $3, $4, NULL, NULL)',
      [code, first, last, 'active']
    );
    inserted++;
  }
  console.log('Inserted:', inserted, '| Skipped (already exist):', skipped);
  client.end();
}).catch(e => { console.error(e.message); client.end(); process.exit(1); });
