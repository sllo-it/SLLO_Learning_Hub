const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const xlsx = require('xlsx');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

// Utility functions to read/write games.json safely
const getGamesPath = () => path.join(__dirname, 'games.json');
const readGamesJSON = () => {
  try {
    const data = fs.readFileSync(getGamesPath(), 'utf8');
    return JSON.parse(data);
  } catch (e) {
    return [];
  }
};
const writeGamesJSON = (data) => {
  fs.writeFileSync(getGamesPath(), JSON.stringify(data, null, 2), 'utf8');
};
function toCamelCase(str) {
  return str
    .toLowerCase()
    .replace(/[^a-zA-Z0-9]+(.)/g, (match, char) => char.toUpperCase());
}

// Multer Storage configuration for processing files dynamically
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // Generate/Find folder name based on the submitted English title
    const gameTitle = req.body.title || 'unnamed_game';
    const folderName = toCamelCase(gameTitle);
    const dir = path.join(__dirname, folderName);
    
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    if (file.fieldname === 'gameFile') cb(null, 'index.html');
    else if (file.fieldname === 'iconFile') cb(null, 'icon.png');
    else if (file.fieldname === 'previewFile') cb(null, 'preview.png');
    else cb(null, file.originalname);
  }
});
const upload = multer({ storage: storage });

// Storage configuration specifically for the Excel importer template
const excelStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, __dirname),
  filename: (req, file, cb) => cb(null, 'import_template.xlsx')
});
const uploadExcel = multer({ storage: excelStorage });

// 1 & 2. API to Save/Modify Game with File Uploads
app.post('/api/save-game-form', upload.fields([
  { name: 'gameFile', maxCount: 1 },
  { name: 'iconFile', maxCount: 1 },
  { name: 'previewFile', maxCount: 1 }
]), (req, res) => {
  const allGames = readGamesJSON();
  const id = toCamelCase(req.body.title);
  const gameTitle = req.body.title;
  const folderName = id;

  const existingIndex = allGames.findIndex(x => x.id === id);
  let oldGame = existingIndex >= 0 ? allGames[existingIndex] : null;

  // Build structural paths for our assets inside the game hub mapping environment
  const gameObj = {
    id: id,
    title: gameTitle,
    title_translate: req.body.title_translate || '',
    subject: req.body.subject || '',
    topic: req.body.topic || '',
    grade: req.body.grade || 'All Grades',
    unit: req.body.unit || '',
    level: req.body.level || 'Beginner',
    outcomes: req.body.outcomes || '',
    path: `${folderName}/index.html`,
    icon: req.files['iconFile'] ? `${folderName}/icon.png` : (oldGame ? oldGame.icon : ''),
    preview: req.files['previewFile'] ? `${folderName}/preview.png` : (oldGame ? oldGame.preview : '')
  };

  if (existingIndex >= 0) {
    allGames[existingIndex] = gameObj;
  } else {
    allGames.push(gameObj);
  }

  writeGamesJSON(allGames);
  res.json({ success: true, message: 'Game saved successfully!' });
});

// 3. Import by Excel API ("GamesSummary(Team1)")
const getVal = (row, searchKeywords) => {
  const keys = Object.keys(row);
  for (const search of searchKeywords) {
    // Clean the Excel key: remove newlines, quotes, extra spaces, and make lowercase
    const matchedKey = keys.find(k => {
      const cleanKey = k.toLowerCase()
                        .replace(/[\r\n]+/g, ' ')  // Turn newlines into spaces
                        .replace(/["']/g, '')       // Strip quotes
                        .replace(/\s+/g, ' ')       // Collapse multiple spaces into one
                        .trim();
      return cleanKey.includes(search.toLowerCase());
    });
    
    if (matchedKey && row[matchedKey] !== undefined && row[matchedKey] !== null) {
      return String(row[matchedKey]).trim();
    }
  }
  return '';
};

// The Refined Route
app.post('/api/import-excel', uploadExcel.single('excelFile'), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded.' });

  try {
    const workbook = xlsx.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    
    // defval: "" ensures that blank spreadsheet cells don't throw off our keys
    const rows = xlsx.utils.sheet_to_json(sheet, { defval: "" });

    let allGames = readGamesJSON();
    let duplicates = [];
    let addedCount = 0;

    rows.forEach((row) => {
      // Look for the title using broad keywords that match your column exactly
      const title = getVal(row, ['title of the game', 'game title', 'title']);
      
      // If a row doesn't have a title, or it's just a spacer row, skip it safely
      if (!title || title === "" || title.toLowerCase().includes('date generated')) return; 

      const folderName = toCamelCase(title);
      const uniqueId = folderName;

      // Check if this game is already in our system
      const isDuplicate = allGames.some(g => g.title.toLowerCase().trim() === title.toLowerCase().trim());
      if (isDuplicate) {
        duplicates.push(title);
        return;
      }

      // Auto-create folder structures for the newly imported game
      const targetDir = path.join(__dirname, folderName);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      // Read matching columns explicitly from your Team template
      const newGame = {
        id: uniqueId,
        title: title,
        title_translate: getVal(row, ['title of the game in kiyarwanda', 'title_translate']), 
        subject: getVal(row, ['reb subject', 'if not under rwb, subject', 'subject']) || 'Others',
        topic: getVal(row, ['reb topic', 'if not under rwb, topic', 'topic']) || '',
        grade: getVal(row, ['reb grade', 'grade']) || 'All Grades',
        unit: getVal(row, ['reb unit', 'unit']) || '',
        level: getVal(row, ['level']) || 'All',
        outcomes: getVal(row, ['learning outcomes', 'outcomes']) || '',
        path: '', // Blank until the teacher uploads the specific HTML module file
        icon: '',
        preview: ''
      };

      allGames.push(newGame);
      addedCount++;
    });

    writeGamesJSON(allGames);
    
    // Clean up the temporary upload file from the server
    fs.unlinkSync(req.file.path);

    res.json({ success: true, addedCount, duplicates });
  } catch (err) {
    console.error("Excel Import Error Details: ", err);
    res.status(500).json({ success: false, message: 'Failed to process file. Check console for details.' });
  }
});

// 4. Complete System Erasure API (Games & Directory Storage deletion)
app.delete('/api/delete-game/:id', (req, res) => {
  const gameId = req.params.id;
  let allGames = readGamesJSON();
  
  const gameToDelete = allGames.find(g => g.id === gameId);
  if (!gameToDelete) return res.status(404).json({ success: false, message: 'Game not found.' });

  // Locate directory signature path
  if (gameToDelete.path) {
    const gameFolderName = gameToDelete.path.split('/')[0];
    const fullFolderPath = path.join(__dirname, gameFolderName);

    if (fs.existsSync(fullFolderPath) && gameFolderName !== '.' && gameFolderName !== '..') {
      try {
        fs.rmSync(fullFolderPath, { recursive: true, force: true });
        console.log(`Directory wiped safely from disk: ${fullFolderPath}`);
      } catch (err) {
        console.error(`Directory clearing hiccup:`, err);
      }
    }
  }

  // Rewrite runtime collection mapping
  allGames = allGames.filter(g => g.id !== gameId);
  writeGamesJSON(allGames);

  res.json({ success: true, message: 'Game directory and record removed successfully.' });
});

app.listen(PORT, () => console.log(`Server handling storage triggers live on port ${PORT}`));