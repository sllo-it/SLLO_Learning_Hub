const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const xlsx = require('xlsx');
const AdmZip = require('adm-zip');

const app = express();
const PORT = process.env.PORT || 8082;

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

// Ensure structural directories exist
const gamesDir = path.join(__dirname, 'src', 'games');
if (!fs.existsSync(gamesDir)) fs.mkdirSync(gamesDir, { recursive: true });

const picturesDir = path.join(__dirname, 'src', 'pictures');
if (!fs.existsSync(picturesDir)) fs.mkdirSync(picturesDir, { recursive: true });

const zipStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, __dirname),
  filename: (req, file, cb) => cb(null, 'temp_upload_' + Date.now() + '.zip')
});
const uploadZip = multer({ storage: zipStorage });

// Multer Storage configuration for processing files dynamically
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    if (file.fieldname === 'gameFile') {
      cb(null, gamesDir);
    } else if (file.fieldname === 'iconFile') {
      cb(null, picturesDir);
    } else {
      cb(null, __dirname);
    }
  },
  filename: function (req, file, cb) {
    cb(null, file.originalname);
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
  const gameName = id;

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
    path: `src/games/${gameName}`,
    icon: req.files['iconFile'] ? `src/pictures/${gameName}_icon.png` : (oldGame ? oldGame.icon : ''),
    preview: req.files['previewFile'] ? `src/pictures/${gameName}_preview.png` : (oldGame ? oldGame.preview : '')
  };

  if (existingIndex >= 0) {
    allGames[existingIndex] = gameObj;
  } else {
    allGames.push(gameObj);
  }

  if (req.files['gameFile']) {
    fs.rename(req.files['gameFile'][0].path, path.join(gamesDir, `${gameName}.html`), (err) => {
      if (err) console.error("Error moving game file:", err);
    });
  }

  if (req.files['iconFile']) {
    fs.rename(req.files['iconFile'][0].path, path.join(picturesDir, `${gameName}_icon.png`), (err) => {
      if (err) console.error("Error moving icon file:", err);
    });
  }

  if (req.files['previewFile']) {
    fs.rename(req.files['previewFile'][0].path, path.join(picturesDir, `${gameName}_preview.png`), (err) => {
      if (err) console.error("Error moving preview file:", err);
    });
  }

  writeGamesJSON(allGames);
  res.json({ success: true, message: 'Game saved successfully!' });
});

// 3. Import by Excel API
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
      const title = getVal(row, ['title of the game', 'title of the game (keep within 5 words)', 'game title', 'title']);
      
      // If a row doesn't have a title, or it's just a spacer row, skip it safely
      if (!title || title === "" || title.toLowerCase().includes('date generated')) return; 

      const folderName = 'src/games/'; // Use a consistent folder structure for the game files
      const uniqueId = toCamelCase(title);

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
        title_translate: getVal(row, ['title of the game in kiyarwanda', 'title_translate', 'title of the game in mongolian', 'title']), 
        subject: getVal(row, ['reb subject', 'if not under rwb, subject', 'subject']) || 'Others',
        topic: getVal(row, ['reb topic', 'if not under rwb, topic', 'topic']) || '',
        grade: getVal(row, ['reb grade', 'grade']) || 'All Grades',
        unit: getVal(row, ['reb unit', 'unit']) || '',
        level: getVal(row, ['level']) || 'All',
        outcomes: getVal(row, ['learning outcomes', 'outcomes']) || '',
        path: `src/games/${getVal(row, ['html file name (e.g. maths.html)', 'html file name', 'html file', 'htmlfile']) || ''}`,
        icon: `src/pictures/${getVal(row, ['iconFile (.png)', 'iconfile', 'icon file', 'icon file name']) || ''}`,
        preview: `src/pictures/${getVal(row, ['previewfile (.png)', 'previewfile', 'preview file name', 'preview file']) || ''}`
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

// Upload zip file and extract to src/games
app.post('/api/upload-zip', uploadZip.single('zipFile'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No ZIP file uploaded.' });
  }

  try {
    // Read the uploaded ZIP file
    const zip = new AdmZip(req.file.path);
    const zipEntries = zip.getEntries(); // Get a list of every file inside the ZIP

    // Iterate through each file inside the ZIP
    zipEntries.forEach(function(zipEntry) {
      // Skip any empty folders inside the zip
      if (!zipEntry.isDirectory) {
        
        // Check if the file is a PNG (case-insensitive)
        if (zipEntry.name.toLowerCase().endsWith('.png')) {
          // Extract PNGs to src/pictures/
          // The "false" parameter flattens the path, so it ignores folders inside the zip
          // The "true" parameter tells it to overwrite existing files
          zip.extractEntryTo(zipEntry, picturesDir, false, true);
        } else {
          // Extract everything else (.html, .js, .svg, etc.) to src/games/
          zip.extractEntryTo(zipEntry, gamesDir, false, true);
        }
        
      }
    });

    // Delete the temporary ZIP file from the server
    fs.unlinkSync(req.file.path);

    res.json({ success: true, message: 'Files extracted and sorted successfully!' });
  } catch (err) {
    console.error("ZIP Extraction Error: ", err);
    
    // Attempt to clean up the broken zip file
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    
    res.status(500).json({ success: false, message: 'Failed to extract ZIP file.' });
  }
});

// 4. Complete System Erasure API (Games & Directory Storage deletion)
app.delete('/api/delete-game/:id', (req, res) => {
  const gameId = req.params.id;
  let allGames = readGamesJSON();
  
  const gameToDelete = allGames.find(g => g.id === gameId);
  if (!gameToDelete) return res.status(404).json({ success: false, message: 'Game not found.' });

  // Clear up the HTML file
  if (gameToDelete.path && gameToDelete.path.startsWith('src/games/')) {
    const gamePath = gameToDelete.path;
    if (fs.existsSync(gamePath)) {
      if (fs.existsSync(gamePath)) {
            try { fs.unlinkSync(gamePath); } catch (err) { console.error(`File clearing hiccup:`, err); }
          }
    }
  }

  // Clean up the Icon and preview files if they exist
  if (gameToDelete.icon && gameToDelete.icon.startsWith('src/pictures/')) {
    const iconPath = gameToDelete.icon;
    if (fs.existsSync(iconPath)) {
      try { fs.unlinkSync(iconPath); } catch (err) { console.error(`Icon clearing hiccup:`, err); }
    }
  }

  if (gameToDelete.preview && gameToDelete.preview.startsWith('src/pictures/')) {
    const previewPath = gameToDelete.preview;
    if (fs.existsSync(previewPath)) {
      try { fs.unlinkSync(previewPath); } catch (err) { console.error(`Preview clearing hiccup:`, err); }
    }
  }

  // Rewrite runtime collection mapping
  allGames = allGames.filter(g => g.id !== gameId);
  writeGamesJSON(allGames);

  res.json({ success: true, message: 'Game directory and record removed successfully.' });
});

app.listen(PORT, () => console.log(`Server handling storage triggers live on port ${PORT}`));