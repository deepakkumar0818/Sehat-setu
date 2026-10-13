// Reference pools used to generate realistic, Indian-context demo data.
// All names/contact details are fictional.

export const MALE_FIRST_NAMES = [
  "Rahul", "Amit", "Vikram", "Rohit", "Sanjay", "Anmol", "Karan", "Arjun",
  "Nikhil", "Suresh", "Rajesh", "Manoj", "Deepak", "Ashok", "Vivek", "Ankit",
  "Gaurav", "Harsh", "Varun", "Aditya", "Naveen", "Ramesh", "Sunil", "Yash",
  "Mohit", "Tarun", "Vishal", "Abhishek", "Kunal", "Siddharth", "Parth",
  "Rohan", "Aakash", "Manish", "Prakash", "Anil", "Sameer", "Vivan", "Devendra",
  "Ravi",
];

export const FEMALE_FIRST_NAMES = [
  "Priya", "Anjali", "Neha", "Pooja", "Kavita", "Sunita", "Rekha", "Meena",
  "Shreya", "Divya", "Anita", "Nisha", "Swati", "Kiran", "Sapna", "Ritu",
  "Pallavi", "Simran", "Aarti", "Deepika", "Manisha", "Preeti", "Komal",
  "Vandana", "Suman", "Geeta", "Jyoti", "Ishita", "Tanvi", "Sneha", "Payal",
  "Radhika", "Bhavna", "Kirti", "Sarita", "Alka", "Namita", "Charu", "Isha",
  "Megha",
];

export const LAST_NAMES = [
  "Sharma", "Verma", "Gupta", "Singh", "Kumar", "Mehta", "Kapoor", "Malhotra",
  "Chopra", "Bansal", "Aggarwal", "Joshi", "Nair", "Rao", "Reddy", "Iyer",
  "Bhatia", "Khanna", "Saxena", "Chauhan", "Rana", "Thakur", "Mishra",
  "Dutta", "Sinha", "Arora", "Sethi", "Bhalla", "Chawla", "Grover",
];

export const DOCTOR_QUALIFICATIONS = [
  "MBBS, MD",
  "MBBS, MS",
  "MBBS, DNB",
  "MBBS, MD, DM",
  "MBBS",
  "BDS, MDS",
  "MBBS, MD, FRCP",
];

export const SPECIALIZATIONS = [
  "Internal Medicine",
  "General Physician",
  "Pediatrics",
  "Gynecology",
  "Orthopedics",
  "Cardiology",
  "Dermatology",
  "ENT",
  "Ophthalmology",
  "Psychiatry",
  "Endocrinology",
  "Pulmonology",
];

export const CLINIC_NAME = "Sehat Setu";

/**
 * The master specialty catalog — broader than SPECIALIZATIONS above (which
 * lists only the specialties with seeded doctors). Used by the clinic
 * onboarding wizard's specialty picker and specialty-management screens.
 * `icon` names correspond to keys in components/public/specialty-grid.tsx's
 * SPECIALTY_ICONS map, falling back to a generic stethoscope icon.
 */
export const SPECIALTY_CATALOG: { name: string; description: string; services: string[] }[] = [
  { name: "General Medicine", description: "Everyday illnesses, checkups, and the first stop for most health concerns.", services: ["General Consultation", "Health Checkup", "Vaccination", "Chronic Disease Management"] },
  { name: "Dermatology", description: "Skin, hair, and nail conditions from acne to chronic concerns.", services: ["Acne Treatment", "Skin Allergy", "Hair Loss", "Eczema", "Psoriasis", "Cosmetic Dermatology"] },
  { name: "Cardiology", description: "Heart health, blood pressure, and cardiovascular conditions.", services: ["ECG", "Blood Pressure Evaluation", "Heart Consultation", "Cardiac Follow-up"] },
  { name: "Pediatrics", description: "Complete care for infants, children, and adolescents.", services: ["Child Wellness Visit", "Vaccination", "Growth Monitoring", "Newborn Care"] },
  { name: "Gynecology", description: "Women's reproductive health, pregnancy, and wellness care.", services: ["Prenatal Care", "Gynecological Exam", "Family Planning", "Menopause Care"] },
  { name: "Orthopedics", description: "Bones, joints, muscles, and sports injuries.", services: ["Fracture Care", "Joint Pain Evaluation", "Sports Injury", "Physiotherapy Referral"] },
  { name: "Neurology", description: "Brain, spine, and nervous system conditions.", services: ["Headache & Migraine", "Seizure Evaluation", "Stroke Follow-up", "Nerve Conduction Study"] },
  { name: "ENT", description: "Ear, nose, and throat conditions, from infections to hearing concerns.", services: ["Hearing Test", "Sinus Treatment", "Throat Infection", "Ear Cleaning"] },
  { name: "Dentistry", description: "Oral health, from routine cleanings to dental procedures.", services: ["Dental Checkup", "Cleaning & Scaling", "Root Canal", "Tooth Extraction"] },
  { name: "Ophthalmology", description: "Eye exams, vision correction, and eye health conditions.", services: ["Vision Test", "Cataract Evaluation", "Glaucoma Screening", "Eye Infection"] },
  { name: "Psychiatry", description: "Mental health support, counselling, and psychiatric care.", services: ["Counselling", "Anxiety & Depression", "Medication Management", "Sleep Disorders"] },
  { name: "Gastroenterology", description: "Digestive system conditions from the stomach to the liver.", services: ["Endoscopy Referral", "Acid Reflux", "Liver Function Review", "IBS Management"] },
  { name: "Pulmonology", description: "Lung and respiratory conditions, including asthma and infections.", services: ["Spirometry", "Asthma Management", "Respiratory Infection", "Sleep Apnea Screening"] },
  { name: "Urology", description: "Urinary tract and male reproductive health.", services: ["UTI Treatment", "Kidney Stone Evaluation", "Prostate Screening"] },
  { name: "Nephrology", description: "Kidney health and chronic kidney disease management.", services: ["Kidney Function Review", "Dialysis Consultation", "Hypertension Management"] },
  { name: "Endocrinology", description: "Hormonal conditions including diabetes and thyroid disorders.", services: ["Diabetes Management", "Thyroid Evaluation", "Hormone Panel Review"] },
  { name: "Oncology", description: "Cancer screening, diagnosis, and treatment coordination.", services: ["Cancer Screening", "Chemotherapy Coordination", "Follow-up Care"] },
  { name: "Rheumatology", description: "Autoimmune and joint-related inflammatory conditions.", services: ["Arthritis Management", "Autoimmune Evaluation", "Joint Injection"] },
  { name: "Physiotherapy", description: "Movement, rehabilitation, and physical recovery.", services: ["Post-Surgery Rehab", "Pain Management", "Mobility Therapy"] },
  { name: "Radiology", description: "Diagnostic imaging including X-ray, CT, MRI, and ultrasound.", services: ["X-Ray", "CT Scan", "MRI", "Ultrasound"] },
  { name: "Pathology", description: "Laboratory diagnosis through blood and tissue analysis.", services: ["Blood Tests", "Biopsy Analysis", "Culture & Sensitivity"] },
  { name: "Diabetology", description: "Focused diabetes care and long-term management.", services: ["Diabetes Screening", "Insulin Management", "Diet Counselling"] },
  { name: "Ayurveda", description: "Traditional Ayurvedic consultation and treatment.", services: ["Ayurvedic Consultation", "Panchakarma", "Herbal Therapy"] },
  { name: "Homeopathy", description: "Homeopathic consultation and remedies.", services: ["Homeopathic Consultation", "Chronic Condition Management"] },
  { name: "Nutrition & Dietetics", description: "Diet planning and nutritional counselling.", services: ["Diet Planning", "Weight Management", "Nutritional Counselling"] },
];

export const BRANCHES = [
  { name: "Sehat Setu Multispeciality Clinic", city: "Chandigarh", address: "SCO 42-43, Sector 17, Chandigarh" },
  { name: "CarePoint Medical Centre", city: "Mohali", address: "Phase 7, Industrial Area, Mohali" },
  { name: "WellSpring Health Clinic", city: "Panchkula", address: "Sector 11, Panchkula" },
  { name: "Sehat Setu Health Hub", city: "Delhi", address: "Community Centre, Saket, New Delhi" },
  { name: "Sehat Setu Family Clinic", city: "Gurgaon", address: "Sector 29, Gurgaon" },
] as const;

export const SYMPTOMS = [
  "Fever", "Cough", "Fatigue", "Headache", "Sore throat", "Body ache",
  "Nausea", "Dizziness", "Shortness of breath", "Chest discomfort",
  "Joint pain", "Abdominal pain", "Loss of appetite", "Skin rash",
  "Mild cough", "Running nose", "Back pain", "Vomiting", "Diarrhea",
  "Anxiety", "Insomnia", "Blurred vision",
];

export const DIAGNOSES = [
  "Viral fever", "Upper respiratory tract infection", "Seasonal allergy",
  "Hypertension", "Type 2 diabetes mellitus", "Gastroenteritis",
  "Migraine", "Acute bronchitis", "Iron deficiency anemia",
  "Lower back strain", "Osteoarthritis", "Anxiety disorder",
  "Urinary tract infection", "Dermatitis", "Hypothyroidism",
  "Acid reflux (GERD)", "Conjunctivitis", "Sinusitis",
];

export const ALLERGIES = [
  "Penicillin", "Sulfa drugs", "Dust", "Pollen", "Peanuts", "Shellfish",
  "Latex", "Aspirin", "Lactose", "None known",
];

export const CHRONIC_CONDITIONS = [
  "Hypertension", "Type 2 diabetes", "Asthma", "Hypothyroidism",
  "Coronary artery disease", "Chronic kidney disease", "None",
];

export const MEDICINES = [
  { name: "Paracetamol", strength: "500 mg", category: "Analgesic" },
  { name: "Azithromycin", strength: "500 mg", category: "Antibiotic" },
  { name: "Amoxicillin", strength: "250 mg", category: "Antibiotic" },
  { name: "Cetirizine", strength: "10 mg", category: "Antihistamine" },
  { name: "Metformin", strength: "500 mg", category: "Antidiabetic" },
  { name: "Amlodipine", strength: "5 mg", category: "Antihypertensive" },
  { name: "Omeprazole", strength: "20 mg", category: "Antacid" },
  { name: "Ibuprofen", strength: "400 mg", category: "Analgesic" },
  { name: "Levothyroxine", strength: "50 mcg", category: "Hormone" },
  { name: "Atorvastatin", strength: "10 mg", category: "Statin" },
  { name: "Vitamin D3", strength: "60000 IU", category: "Supplement" },
  { name: "Vitamin B12", strength: "1500 mcg", category: "Supplement" },
  { name: "Ondansetron", strength: "4 mg", category: "Antiemetic" },
  { name: "Salbutamol Inhaler", strength: "100 mcg", category: "Bronchodilator" },
  { name: "Losartan", strength: "50 mg", category: "Antihypertensive" },
  { name: "Pantoprazole", strength: "40 mg", category: "Antacid" },
  { name: "Cough Syrup (Dextromethorphan)", strength: "10 mg/5ml", category: "Cough suppressant" },
  { name: "ORS Sachet", strength: "21.8 g", category: "Rehydration" },
  { name: "Multivitamin", strength: "1 tablet", category: "Supplement" },
  { name: "Diclofenac Gel", strength: "1%", category: "Topical analgesic" },
  { name: "Ciprofloxacin", strength: "500 mg", category: "Antibiotic" },
  { name: "Doxycycline", strength: "100 mg", category: "Antibiotic" },
  { name: "Metronidazole", strength: "400 mg", category: "Antibiotic" },
  { name: "Clopidogrel", strength: "75 mg", category: "Antiplatelet" },
  { name: "Telmisartan", strength: "40 mg", category: "Antihypertensive" },
  { name: "Glimepiride", strength: "2 mg", category: "Antidiabetic" },
  { name: "Insulin Glargine", strength: "100 IU/ml", category: "Antidiabetic" },
  { name: "Montelukast", strength: "10 mg", category: "Antihistamine" },
  { name: "Fexofenadine", strength: "120 mg", category: "Antihistamine" },
  { name: "Amitriptyline", strength: "25 mg", category: "Antidepressant" },
  { name: "Sertraline", strength: "50 mg", category: "Antidepressant" },
  { name: "Alprazolam", strength: "0.25 mg", category: "Anxiolytic" },
  { name: "Ranitidine", strength: "150 mg", category: "Antacid" },
  { name: "Domperidone", strength: "10 mg", category: "Antiemetic" },
  { name: "Folic Acid", strength: "5 mg", category: "Supplement" },
  { name: "Calcium + Vitamin D3", strength: "500 mg", category: "Supplement" },
  { name: "Iron + Folic Acid", strength: "100 mg", category: "Supplement" },
  { name: "Betamethasone Cream", strength: "0.05%", category: "Topical steroid" },
  { name: "Clotrimazole Cream", strength: "1%", category: "Antifungal" },
  { name: "Hydrocortisone Cream", strength: "1%", category: "Topical steroid" },
] as const;

export const SUPPLIERS = [
  "MedPlus Distributors", "Apollo Pharma Supply", "Wellness Wholesale Co.",
  "HealthFirst Pharma", "Sunrise Medical Supplies", "CarePoint Distributors",
];

export const LAB_REPORT_TYPES = [
  "CBC", "LFT", "KFT", "Lipid Profile", "X-Ray", "MRI", "CT Scan", "Ultrasound", "ECG", "Other",
] as const;

export const CBC_PARAMETERS = [
  { parameter: "Hemoglobin", unit: "g/dL", range: "13.0 - 17.0" },
  { parameter: "WBC Count", unit: "/cumm", range: "4000 - 11000" },
  { parameter: "Platelet Count", unit: "lakh/cumm", range: "1.5 - 4.5" },
  { parameter: "RBC Count", unit: "mill/cumm", range: "4.5 - 5.5" },
  { parameter: "Hematocrit", unit: "%", range: "40 - 50" },
];

export const LIPID_PARAMETERS = [
  { parameter: "Total Cholesterol", unit: "mg/dL", range: "< 200" },
  { parameter: "HDL Cholesterol", unit: "mg/dL", range: "> 40" },
  { parameter: "LDL Cholesterol", unit: "mg/dL", range: "< 130" },
  { parameter: "Triglycerides", unit: "mg/dL", range: "< 150" },
];

export const EXPENSE_DESCRIPTIONS: Record<string, string[]> = {
  rent: ["Monthly clinic rent"],
  salary: ["Staff salary disbursement", "Doctor consultation payout"],
  utilities: ["Electricity bill", "Water bill", "Internet & telephone"],
  equipment: ["ECG machine maintenance", "Autoclave servicing", "New BP monitors"],
  medicine_purchase: ["Bulk medicine purchase", "Pharmacy restock order"],
  lab_expense: ["Lab reagents purchase", "Lab equipment calibration"],
  marketing: ["Social media promotion", "Local newspaper ad", "Health camp sponsorship"],
  maintenance: ["AC servicing", "Furniture repair", "Building maintenance"],
  other: ["Miscellaneous office supplies", "Courier charges"],
};

export const AVATAR_COLORS = [
  "#2563EB", "#0F766E", "#7C3AED", "#D97706", "#DC2626", "#0284C7", "#16A34A", "#DB2777",
];

export const VISIT_REASONS = [
  "Fever and cold", "Routine checkup", "Follow-up visit", "Skin rash",
  "Diabetes management", "Blood pressure check", "Stomach pain",
  "Annual health checkup", "Vaccination", "Joint pain consultation",
  "Pregnancy checkup", "Child wellness visit", "Eye checkup",
];
