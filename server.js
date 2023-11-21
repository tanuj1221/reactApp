const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const csv = require('csv-parser');
const fs = require('fs');
const cors = require('cors');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;


// // Serve static files from the 'build' directory
// app.use(express.static(path.join(__dirname, './client/build')));

// // Define any other API routes or middleware here

// // Catch-all route to serve 'index.html' for any unrecognized routes
// app.get('/', (req, res) => {
//   res.sendFile(path.join(__dirname, './client/build', 'index.html'));
// });




const db = new sqlite3.Database('./database.db');

app.use(cors());
app.use(express.json({ limit: '100mb' }));
const bodyParser = require('body-parser');
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true, parameterLimit: 50000 }));
// Create a table if not exists
db.run(`CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT
)`);

// Configure multer for file uploads
const upload = multer({ dest: 'uploads/' });

// Endpoint to import data from CSV file
app.post('/api/import-csv/:tableName', upload.single('csvFilePath'), (req, res) => {
  const tableName = req.params.tableName;
  const csvFilePath = req.file.path; // Use req.file.path to get the file path

  if (!tableName || !csvFilePath) {
    return res.status(400).json({ error: 'Table name and CSV file path are required' });
  }

  const rows = [];
  let columns = [];

  const stream = fs.createReadStream(csvFilePath)
    .pipe(csv())
    .on('data', (row) => {
      if (columns.length === 0) {
        // Store column headers from the first row
        columns = Object.keys(row);
      }
      rows.push(row);
    })
    .on('end', () => {
      if (columns.length === 0) {
        return res.status(500).json({ error: 'No data found in the CSV file' });
      }

      // Create the table if not exists
      const createTableQuery = `CREATE TABLE IF NOT EXISTS ${tableName} (${columns.map(column => `${column} TEXT`).join(', ')})`;

      db.run(createTableQuery, (createTableError) => {
        if (createTableError) {
          return res.status(500).json({ error: createTableError.message });
        }

        rows.forEach(row => {
          const values = columns.map(column => row[column]);
          const placeholders = columns.map(() => '?').join(', ');
          const insertQuery = `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`;

          db.run(insertQuery, values, (insertError) => {
            if (insertError) {
              console.error('Error inserting data:', insertError.message);
              return res.status(500).json({ error: insertError.message });
            }
          });
        });

        // Remove the uploaded file after processing
        fs.unlinkSync(csvFilePath);
        res.json({ message: `CSV data imported into table '${tableName}' successfully` });
      });
    });

  stream.on('error', (csvError) => {
    console.error('CSV stream error:', csvError.message);
    res.status(500).json({ error: csvError.message });
  });
});


// Endpoint to get a list of tables
app.get('/api/tables', (req, res) => {
    db.all("SELECT name FROM sqlite_master WHERE type='table'", (error, tables) => {
      if (error) {
        return res.status(500).json({ error: error.message });
      }
  
      const tableNames = tables.map(table => table.name).filter(name => name !== 'items'); // Exclude the 'items' table
      res.json({ tables: tableNames });
    });
  });


// Endpoint to get data for a specific table
app.get('/api/table-data/:tableName', (req, res) => {
    const tableName = req.params.tableName;
  
    if (!tableName) {
      return res.status(400).json({ error: 'Table name is required' });
    }
  
    db.all(`SELECT * FROM ${tableName}`, (error, tableData) => {
      if (error) {
        return res.status(500).json({ error: error.message });
      }
  
      res.json({ tableData });
    });
  });
  
// Endpoint to check if a table has an 'id' column and retrieve all data
app.get('/api/check-id-column/:tableName', (req, res) => {
    const tableName = req.params.tableName;
    const query = `PRAGMA table_info(${tableName})`;
  
    db.all(query, [], async (err, rows) => {
      if (err) {
        console.error(err.message);
        return res.status(500).json({ error: 'Internal Server Error' });
      }
  
      // Check if the table exists
      const tableExists = rows.length > 0;
  
      if (!tableExists) {
        // Create the table based on CSV columns
        const csvFilePath = 'path/to/your/batch_data.csv'; // Update with your actual CSV file path
        const stream = fs.createReadStream(csvFilePath).pipe(csv());
  
        let columns = [];
  
        stream.on('data', (row) => {
          columns = Object.keys(row);
        });
  
        stream.on('end', () => {
          // Create the table with the columns
          const createTableQuery = `CREATE TABLE IF NOT EXISTS ${tableName} (${columns.map(column => `${column} TEXT`).join(', ')})`;
  
          db.run(createTableQuery, (createTableError) => {
            if (createTableError) {
              return res.status(500).json({ error: createTableError.message });
            }
  
            // Fetch all data from the table
            const selectAllQuery = `SELECT * FROM ${tableName}`;
  
            db.all(selectAllQuery, [], (selectAllError, dataRows) => {
              if (selectAllError) {
                return res.status(500).json({ error: selectAllError.message });
              }
  
              res.json({ hasIdColumn: true, data: dataRows });
            });
          });
        });
      } else {
        // Fetch all data from the table
        const selectAllQuery = `SELECT * FROM ${tableName}`;
  
        db.all(selectAllQuery, [], (selectAllError, dataRows) => {
          if (selectAllError) {
            return res.status(500).json({ error: selectAllError.message });
          }
  
          res.json({ hasIdColumn: true, data: dataRows });
        });
      }
    });
  });
  

  app.post('/api/save-changes/:tableName', (req, res) => {
    const tableName = req.params.tableName;
    const tableData = req.body.tableData;
  
    // Start a database transaction
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
  
      // Delete all rows from the table
      db.run(`DELETE FROM ${tableName}`, [], (err) => {
        if (err) {
          console.error(err.message);
          db.run('ROLLBACK');
          return res.status(500).json({ message: 'Internal Server Error' });
        }
      });
  
      // Insert new data
      tableData.forEach((row) => {
        // Generate a query to insert this row
        const insertQuery = `INSERT INTO ${tableName}(${Object.keys(row).join(', ')}) VALUES (${Object.keys(row).map(() => '?').join(', ')})`;
  
        // Get the values for the query parameters
        const values = Object.values(row);
  
        db.run(insertQuery, values, (err) => {
          if (err) {
            console.error(err.message);
            db.run('ROLLBACK');
            return res.status(500).json({ message: 'Internal Server Error' });
          }
        });
      });
  
      db.run('COMMIT');
      res.json({ message: 'Changes saved successfully' });
    });
  });
  

// delete table 
app.delete('/api/delete-table/:tableName', (req, res) => {
  const tableName = req.params.tableName;

  // Start a database transaction
  db.serialize(() => {
    db.run('BEGIN TRANSACTION');

    // Drop the table
    db.run(`DROP TABLE IF EXISTS ${tableName}`, [], (err) => {
      if (err) {
        console.error(err.message);
        db.run('ROLLBACK');
        return res.status(500).json({ message: 'Internal Server Error' });
      }
    });

    db.run('COMMIT');
    res.json({ message: 'Table deleted successfully' });
  });
});

// Create a table if not exists
db.run(`CREATE TABLE IF NOT EXISTS users (
    user_id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT,
    password TEXT
  )`);
  
  // Endpoint to get all users
  app.get('/api/users', (req, res) => {
    const query = 'SELECT * FROM users';
  
    db.all(query, (err, rows) => {
      if (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Internal Server Error' });
        return;
      }
  
      res.json({ users: rows });
    });
  });
  
  // Endpoint to add a new user
  app.post('/api/users', (req, res) => {
    const { role, password } = req.body;
  
    if (!role || !password) {
      return res.status(400).json({ error: 'Role and password are required' });
    }
  
    const query = 'INSERT INTO users (role, password) VALUES (?, ?)';
    const params = [role, password];
  
    db.run(query, params, function (err) {
      if (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Internal Server Error' });
        return;
      }
  
      res.json({ message: `User added with ID ${this.lastID}` });
    });
  });
  
// for user login only 
// Import jsonwebtoken library



// Update your login endpoint
app.post('/api/login', (req, res) => {
    const { user_id, password } = req.body;
    console.log(`Received credentials: user_id = ${user_id}, password = ${password}`);
  
    if (!user_id || !password) {
      return res.status(400).json({ error: 'User ID and password are required' });
    }
  
    const queryUsersTable = 'SELECT * FROM users WHERE user_id = ? AND password = ?';
    db.get(queryUsersTable, [user_id, password], (err, user) => {
      if (err) {
        console.error('Error during querying users table:', err);
        return res.status(500).json({ error: 'Internal Server Error during querying users table' });
      }
  
      if (user) {
        console.log(`Found user in users table: ${JSON.stringify(user)}`);
        const token = createToken({ user_id: user.user_id, role: user.role });
        res.cookie('authToken', token, { httpOnly: true });
        return res.json({ user_id: user.user_id, token, role: user.role });
      }
  
      const queryExuserTable = 'SELECT * FROM exuser WHERE user_id = ? AND password = ?';
      db.get(queryExuserTable, [user_id, password], (exuserErr, exuser) => {
        if (exuserErr) {
          console.error('Error during querying exuser table:', exuserErr);
          return res.status(500).json({ error: 'Internal Server Error during querying exuser table' });
        }
  
        if (exuser) {
          console.log(`Found user in exuser table: ${JSON.stringify(exuser)}`);
          if (exuser.login === "TRUE") {
            console.log(`User is already logged in.`);
            return res.status(401).json({ error: 'User is already logged in elsewhere' });
          }
  
          const updateLoginStatusQuery = 'UPDATE exuser SET login = "TRUE" WHERE user_id = ?';
          db.run(updateLoginStatusQuery, [user_id], (updateErr) => {
            if (updateErr) {
              console.error('Error updating login status:', updateErr);
              return res.status(500).json({ error: 'Internal Server Error during updating login status' });
            }
  
            console.log(`Updated login status successfully.`);
            // ...
        const token = createToken({ user_id: exuser.user_id, role: exuser.role });
        res.cookie('authToken', token);
        res.cookie('user_id', exuser.user_id);
        return res.json({ user_id: exuser.user_id, token, role: exuser.role });
        // ...
          });
        } else {
          console.log(`No matching user found in either table.`);
          return res.status(401).json({ error: 'Invalid credentials' });
        }
      });
    });
  });
app.post('/api/logout', (req, res) => {
    const { user_id } = req.body;
    console.log('Logging out user ID:', user_id);
  
    const updateLoginStatusQuery = 'UPDATE exuser SET login = "FALSE" WHERE user_id = ?';
    db.run(updateLoginStatusQuery, [user_id], (updateErr) => {
      if (updateErr) {
        console.error('Error updating login status:', updateErr);
        return res.status(500).json({ error: 'Internal Server Error during updating login status' });
      }
  
      console.log(`Updated login status successfully.`);
      return res.json({ success: true });
    });
  });

 

app.get('/api/audio/:user_id', (req, res) => {
    const { user_id } = req.params;
  
    // Fetch batch_code and subject_code from the exuser table based on user_id
    db.get(
      'SELECT batch_code, subject_code, status, last_played_position FROM exuser WHERE user_id = ?',
      [user_id],
      (err, exuserRow) => {
        if (err) {
          console.error(err);
          res.status(500).json({ error: 'Internal Server Error' });
          return;
        }
  
        if (!exuserRow) {
          res.status(404).json({ error: 'User not found' });
          return;
        }
  
        const { batch_code, subject_code, status, last_played_position, duration } = exuserRow;
  
        // Fetch the audio link from the schedule table based on batch_code and subject_code
        db.get(
          'SELECT link_1 FROM schedule WHERE batch_code = ? AND subject_code = ?',
          [batch_code, subject_code],
          (err, scheduleRow) => {
            if (err) {
              console.error(err);
              res.status(500).json({ error: 'Internal Server Error' });
            } else if (scheduleRow) {
              if (status === 'TRUE') {
                if (last_played_position !== duration) {
                  res.json({
                    link: scheduleRow.link_1,
                    last_played_position: last_played_position
                  });
                } else {
                  res.json({
                    link: 'https://drive.google.com/uc?export=download&id=1_kkTyaPocjcy-01fxBRb_M8O5jvjtjDa'
                  });
                }
              } else {
                res.json({
                  link: scheduleRow.link_1,
                  last_played_position: last_played_position
                });
              }
            } else {
              res.status(404).json({ error: 'Audio link not found' });
            }
          }
        );
      }
    );
  });
  
app.put('/api/exuser/:user_id', (req, res) => {
    const { user_id } = req.params;
    const { last_played_position } = req.body;
  
    db.run(
      'UPDATE exuser SET last_played_position = ? WHERE user_id = ?',
      [last_played_position, user_id],
      (err) => {
        if (err) {
          console.error(err);
          res.status(500).json({ error: 'Internal Server Error' });
        } else {
          res.status(200).json({ message: 'Last played position updated successfully' });
        }
      }
    );
  });
  
  // New API endpoint to update the status
app.put('/api/exuser/:user_id', (req, res) => {
      const { user_id } = req.params;
  
      // Execute SQL query to update status
      db.run(
          'UPDATE exuser SET status = "TRUE" WHERE user_id = ?',
          [user_id],
          (err) => {
              if (err) {
                  console.error(err);
                  res.status(500).json({ error: 'Internal Server Error' });
              } else {
                  res.json({ message: 'Status updated successfully' });
                  console.log("status updated")
              }
          }
      );
  });
  
 
// Token creation function using jsonwebtoken
function createToken(payload) {
  return jwt.sign(payload, 'your-secret-key', { expiresIn: '1d' });
}
  
const port = 5000;

app.listen(port, '0.0.0.0', () => {
  console.log(`Server is running on port ${port}`);
});
