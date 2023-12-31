const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const csv = require('csv-parser');
const fs = require('fs');
const cors = require('cors');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const path = require('path');
const CryptoJS = require('crypto-js');
const secretKey = 'your-secret-key';

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());

// Serve static files from the 'build' directory
app.use(express.static(path.join(__dirname, './client/build')));

// Define any other API routes or middleware here

// Catch-all route to serve 'index.html' for any unrecognized routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, './client/build', 'index.html'));
});


function encryptLink(plainText, secretKey) {
  const cipherText = CryptoJS.AES.encrypt(plainText, secretKey).toString();
  return cipherText;
}

const db = new sqlite3.Database('./database.db');


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

      // Drop the existing table if exists
      const dropTableQuery = `DROP TABLE IF EXISTS ${tableName}`;

      db.run(dropTableQuery, (dropTableError) => {
        if (dropTableError) {
          return res.status(500).json({ error: dropTableError.message });
        }

        // Create the table
        const createTableQuery = `CREATE TABLE ${tableName} (${columns.map(column => `${column} TEXT`).join(', ')})`;

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


//  get info for instruction page 
app.get('/api/info/:userId', (req, res) => {
  const userId = req.params.userId;

  // Query exuser table to get subject code, center code, batch code
  db.get(
    'SELECT subject_code, center_code, batch_code FROM exuser WHERE user_id = ?',
    [userId],
    (err, userRow) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Internal Server Error' });
      }

      if (!userRow) {
        return res.status(404).json({ error: 'User not found' });
      }

      const { subject_code, center_code, batch_code } = userRow;

      // Query schedule table to get batch_time, batch_date, and subject
      db.get(
        'SELECT batch_time, batch_date, subject_speed, subject_language FROM schedule WHERE subject_code = ? AND batch_code = ?',
        [subject_code, batch_code],
        (err, scheduleRow) => {
          if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Internal Server Error' });
          }

          // Query center table to get center name
          db.get(
            'SELECT Center_name FROM center WHERE center_code = ?',
            [center_code],
            (err, centerRow) => {
              if (err) {
                console.error(err);
                return res.status(500).json({ error: 'Internal Server Error' });
              }

              if (!centerRow) {
                return res.status(404).json({ error: 'Center not found' });
              }

              const result = {
                user: {
                  subject_code,
                  center_code,
                  batch_code,
                },
                schedule: scheduleRow,
                center: centerRow,
              };

              res.json(result);
            }
          );
        }
      );
    }
  );
});
  
// save table changes 
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

  app.post('/api/save-changes-user/:tableName', (req, res) => {
    const tableName = req.params.tableName;
    const tableData = req.body.tableData;
    const userId = req.body.userId; // Assuming you're passing the userId in the request body
  
    // Start a database transaction
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
  
      // Update data for the user
      tableData.forEach((row) => {
        // Generate a query to update this row
        const updateQuery = `UPDATE ${tableName} SET ${Object.keys(row).map(key => key + ' = ?').join(', ')} WHERE user_id = ?`;
  
        // Get the values for the query parameters
        const values = [...Object.values(row), userId];
  
        db.run(updateQuery, values, (err) => {
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
  

  // get user info for update 
  app.get('/api/:tableName/usersupdate1/:userId', (req, res) => {
    const tableName = req.params.tableName;
    const userId = req.params.userId;
  
    db.get(`SELECT * FROM ${tableName} WHERE user_id = ?`, userId, (err, row) => {
      if (err) {
        console.error(err.message);
        return res.status(500).json({ message: 'Internal Server Error' });
      }
  
      if (row) {
        res.json(row);
      } else {
        res.status(404).json({ message: `User not found with id ${userId}` });
      }
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
      res.cookie('authToken', token, { httpOnly: false });
      res.cookie('userRole', user.role, { httpOnly: false });
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
        if (exuser.login === "TR") {
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
          const updateLogQuery = 'UPDATE logs SET logging = ? WHERE user_id = ?';
          const now = new Date();
          const offsetIST = 330; // IST offset UTC +5:30 
          const istTime = new Date( );
          const options = { timeZone: 'Asia/Kolkata',  hour12: true, year: 'numeric', month: 'numeric', day: 'numeric',hour: 'numeric', minute: 'numeric', second: 'numeric'};
          const loginTime = istTime.toLocaleString('en-IN', options);
         
          db.run(updateLogQuery, [loginTime, user_id], (updateLogErr) => {
            if (updateLogErr) {
              console.error('Error updating logs table:', updateLogErr);
              return res.status(500).json({ error: 'Internal Server Error during updating logs table' });
            }
    
            console.log(`Updated logs table successfully.`);})
        
          // ...
      const token = createToken({ user_id: exuser.user_id, role: exuser.role });
      res.cookie('authToken', token, { httpOnly: false });
      res.cookie('userRole', exuser.role, { httpOnly: false });
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
  
    const updateLoginStatusQuery = 'UPDATE exuser SET login = "TRUE" WHERE user_id = ?';
    db.run(updateLoginStatusQuery, [user_id], (updateErr) => {
      if (updateErr) {
        console.error('Error updating login status:', updateErr);
        return res.status(500).json({ error: 'Internal Server Error during updating login status' });

      }
      const updateLogQuery = 'UPDATE logs SET logout = ? WHERE user_id = ?';
      const now = new Date();
      const offsetIST = 330; // IST offset UTC +5:30 
      const istTime = new Date( );
      const options = { timeZone: 'Asia/Kolkata',  hour12: true, year: 'numeric', month: 'numeric', day: 'numeric',hour: 'numeric', minute: 'numeric', second: 'numeric'};
      const loginTime = istTime.toLocaleString('en-IN', options);
     
      db.run(updateLogQuery, [loginTime, user_id], (updateLogErr) => {
        if (updateLogErr) {
          console.error('Error updating logs table:', updateLogErr);
          return res.status(500).json({ error: 'Internal Server Error during updating logs table' });
        }

        console.log(`Updated logs table successfully.`);})
  
      console.log(`Updated logout status successfully.`);
      return res.json({ success: true });
    });
  });


  app.post('/api/logout2', (req, res) => {
    const { user_id } = req.body;
    console.log('Logging out user ID:', user_id);
  
    const updateLoginStatusQuery = 'UPDATE exuser SET login = "FALSE" WHERE user_id = ?';
    db.run(updateLoginStatusQuery, [user_id], (updateErr) => {
      if (updateErr) {
        console.error('Error updating login status:', updateErr);
        return res.status(500).json({ error: 'Internal Server Error during updating login status' });

      }
   
  
      console.log(`Updated logout status successfully.`);
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
                  const encryptedLink = encryptLink(scheduleRow.link_1, secretKey);
                  res.json({
                    link: encryptedLink,
                    last_played_position: last_played_position
                  });
                  const updateLogQuery = 'UPDATE logs SET passage1 = ? WHERE user_id = ? AND passage1 IS NULL';
                  const now = new Date();
                  const offsetIST = 330; // IST offset UTC +5:30 
                  const istTime = new Date( );
                  const options = { timeZone: 'Asia/Kolkata',  hour12: true, year: 'numeric', month: 'numeric', day: 'numeric',hour: 'numeric', minute: 'numeric', second: 'numeric'};
                  const loginTime = istTime.toLocaleString('en-IN', options);
                 
                  db.run(updateLogQuery, [loginTime, user_id], (updateLogErr) => {
                    if (updateLogErr) {
                      console.error('Error updating logs table:', updateLogErr);
                      return res.status(500).json({ error: 'Internal Server Error during updating logs table' });
                    }
            
                    console.log(`Updated logs table successfully for passage1.`);})
                } else {
                  res.json({
                    link: 'https://drive.google.com/uc?export=download&id=1_kkTyaPocjcy-01fxBRb_M8O5jvjtjDa'
                  });
                }
              } else {
                res.json({
                  link:encryptLink(scheduleRow.link_1, secretKey),
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
  
// get countdownauidoo 


app.get('/api/countaudio/:user_id', (req, res) => {
  const { user_id } = req.params;

  // Fetch batch_code and subject_code from the exuser table based on user_id
  db.get(
    'SELECT batch_code, subject_code, status, countdown_position FROM exuser WHERE user_id = ?',
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

      const { batch_code, subject_code, status, countdown_position, duration } = exuserRow;

      // Fetch the audio link from the schedule table based on batch_code and subject_code
      db.get(
        'SELECT countdown FROM schedule WHERE batch_code = ? AND subject_code = ?',
        [batch_code, subject_code],
        (err, scheduleRow) => {
          if (err) {
            console.error(err);
            res.status(500).json({ error: 'Internal Server Error' });
          } else if (scheduleRow) {
            if (status === 'TRUE') {
              if (countdown_position !== duration) {
                res.json({
                  link: scheduleRow.countdown,
                  countdown_position: countdown_position
                });
                const updateLogQuery = 'UPDATE logs SET countdown = ? WHERE user_id = ? AND countdown IS NULL';
                const now = new Date();
                const offsetIST = 330; // IST offset UTC +5:30 
                const istTime = new Date( );
                const options = { timeZone: 'Asia/Kolkata',  hour12: true, year: 'numeric', month: 'numeric', day: 'numeric',hour: 'numeric', minute: 'numeric', second: 'numeric'};
                const loginTime = istTime.toLocaleString('en-IN', options);
               
                db.run(updateLogQuery, [loginTime, user_id], (updateLogErr) => {
                  if (updateLogErr) {
                    console.error('Error updating logs table:', updateLogErr);
                    return res.status(500).json({ error: 'Internal Server Error during updating logs table' });
                  }
          
                  console.log(`Updated logs table successfully.`);})
              } else {
                res.json({
                  link: 'https://drive.google.com/uc?export=download&id=1_kkTyaPocjcy-01fxBRb_M8O5jvjtjDa'
                });
              }
            } else {
              res.json({
                link: scheduleRow.countdown,
                countdown_position: countdown_position
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


// get countdownauidoo 


app.get('/api/trialaudio/:user_id', (req, res) => {
  const { user_id } = req.params;

  // Fetch batch_code and subject_code from the exuser table based on user_id
  db.get(
    'SELECT batch_code, subject_code, status, trial_position FROM exuser WHERE user_id = ?',
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

      const { batch_code, subject_code, status, trial_position, duration } = exuserRow;

      // Fetch the audio link from the schedule table based on batch_code and subject_code
      db.get(
        'SELECT trialaudio FROM schedule WHERE batch_code = ? AND subject_code = ?',
        [batch_code, subject_code],
        (err, scheduleRow) => {
          if (err) {
            console.error(err);
            res.status(500).json({ error: 'Internal Server Error' });
          } else if (scheduleRow) {
            if (status === 'TRUE') {
              if (trial_position !== duration) {
                const encryptedLink = encryptLink(scheduleRow.trialaudio, secretKey);
                res.json({
                  link: encryptedLink,
                  trial_position: trial_position
                });
                const updateLogQuery = 'UPDATE logs SET trial_passage = ? WHERE user_id = ? AND trial_passage IS NULL';
                const now = new Date();
                const offsetIST = 330; // IST offset UTC +5:30 
                const istTime = new Date( );
                const options = { timeZone: 'Asia/Kolkata',  hour12: true, year: 'numeric', month: 'numeric', day: 'numeric',hour: 'numeric', minute: 'numeric', second: 'numeric'};
                const loginTime = istTime.toLocaleString('en-IN', options);
               
                db.run(updateLogQuery, [loginTime, user_id], (updateLogErr) => {
                  if (updateLogErr) {
                    console.error('Error updating logs table:', updateLogErr);
                    return res.status(500).json({ error: 'Internal Server Error during updating logs table' });
                  }})
                
              } else {
                res.json({
                  link: 'https://drive.google.com/uc?export=download&id=1_kkTyaPocjcy-01fxBRb_M8O5jvjtjDa'
                });
              }
            } else {
              const encryptedLink = encryptLink(scheduleRow.trialaudio, secretKey);
                res.json({
                  link: encryptedLink,
                  trial_position: trial_position
                });
              const updateLogQuery = 'UPDATE logs SET trial_passage = ? WHERE user_id = ? AND trial_passage IS NULL';
              const now = new Date();
              const offsetIST = 330; // IST offset UTC +5:30 
              const istTime = new Date( );
              const options = { timeZone: 'Asia/Kolkata',  hour12: true, year: 'numeric', month: 'numeric', day: 'numeric',hour: 'numeric', minute: 'numeric', second: 'numeric'};
              const loginTime = istTime.toLocaleString('en-IN', options);
             
              db.run(updateLogQuery, [loginTime, user_id], (updateLogErr) => {
                if (updateLogErr) {
                  console.error('Error updating logs table:', updateLogErr);
                  return res.status(500).json({ error: 'Internal Server Error during updating logs table' });
                }})
            }
          } else {
            res.status(404).json({ error: 'Audio link not found' });
          }
        }
      );
    }
  );
});



  // get trial audio 
  app.get('/api/testaudioftech/:user_id', (req, res) => {
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
          'SELECT testaudio FROM schedule WHERE batch_code = ? AND subject_code = ?',
          [batch_code, subject_code],
          (err, scheduleRow) => {
            if (err) {
              console.error(err);
              res.status(500).json({ error: 'Internal Server Error' });
            } else if (scheduleRow) {
              if (status === 'TRUE') {
                if (last_played_position !== duration) {
                  res.json({
                    link: scheduleRow.testaudio,
                    last_played_position: last_played_position
                  });
                } else {
                  res.json({
                    link: 'https://drive.google.com/uc?export=download&id=1_kkTyaPocjcy-01fxBRb_M8O5jvjtjDa'
                  });
                }
              } else {
                res.json({
                  link: scheduleRow.testaudio,
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




// second auido play code 
app.get('/api/audio2/:user_id', (req, res) => {
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
        'SELECT link_2 FROM schedule WHERE batch_code = ? AND subject_code = ?',
        [batch_code, subject_code],
        (err, scheduleRow) => {
          if (err) {
            console.error(err);
            res.status(500).json({ error: 'Internal Server Error' });
          } else if (scheduleRow) {
            if (status === 'TRUE' && last_played_position === duration) {
              
              res.json({
                link_2: 'https://drive.google.com/uc?export=download&id=1_kkTyaPocjcy-01fxBRb_M8O5jvjtjDa',
                last_played_position: last_played_position
              });
            } else {
              const encryptedLink = encryptLink(scheduleRow.link_2, secretKey)
              res.json({
                link_2: encryptedLink,
                last_played_position: last_played_position
              });
              const updateLogQuery = 'UPDATE logs SET passage2 = ? WHERE user_id = ? AND passage2 IS NULL';
              const now = new Date();
              const offsetIST = 330; // IST offset UTC +5:30 
              const istTime = new Date( );
              const options = { timeZone: 'Asia/Kolkata',  hour12: true, year: 'numeric', month: 'numeric', day: 'numeric',hour: 'numeric', minute: 'numeric', second: 'numeric'};
              const loginTime = istTime.toLocaleString('en-IN', options);
             
              db.run(updateLogQuery, [loginTime, user_id], (updateLogErr) => {
                if (updateLogErr) {
                  console.error('Error updating logs table:', updateLogErr);
                  return res.status(500).json({ error: 'Internal Server Error during updating logs table' });
                }})
            
              
              console.log("audio2 played")
            }
          } else {
            res.status(404).json({ error: 'Audio link not found' });
          }
        }
      );
    }
    );
  });

// last played audio 
app.put('/api/exuser1/:user_id', (req, res) => {
  const { user_id } = req.params;
  const { last_played_position } = req.body;

  if (typeof last_played_position !== 'number') {
    res.status(400).json({ error: 'Invalid data type for last_played_position' });
    return;
  }

  db.run(
    'UPDATE exuser SET last_played_position = ? WHERE user_id = ?',
    [last_played_position, user_id],
    function(err) {
      if (err) {
        console.error(err);
        res.status(500).json({ error: 'Could not update last played position' });
        console.log('Could not update last played position')
        return;
      }

      if (this.changes === 0) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      res.json({ message: 'Last played position updated successfully' });
    }
  );
});


// last played coundown audio position 
app.put('/api/countexuser1/:user_id', (req, res) => {
  const { user_id } = req.params;
  const { countdown_position } = req.body;

  if (typeof countdown_position !== 'number') {
    res.status(400).json({ error: 'Invalid data type for countdown_position' });
    return;
  }

  db.run(
    'UPDATE exuser SET countdown_position = ? WHERE user_id = ?',
    [countdown_position, user_id],
    function(err) {
      if (err) {
        console.error(err);
        res.status(500).json({ error: 'Could not update last played position' });
        console.log('Could not update last played position')
        return;
      }

      if (this.changes === 0) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      res.json({ message: 'Last played position updated successfully' });
    }
  );
});

// last played coundown audio position 
app.put('/api/trialexuser1/:user_id', (req, res) => {
  const { user_id } = req.params;
  const { trial_position } = req.body;

  if (typeof trial_position !== 'number') {
    res.status(400).json({ error: 'Invalid data type for trial_position' });
    return;
  }

  db.run(
    'UPDATE exuser SET trial_position = ? WHERE user_id = ?',
    [trial_position, user_id],
    function(err) {
      if (err) {
        console.error(err);
        res.status(500).json({ error: 'Could not update last played position' });
        console.log('Could not update last played position')
        return;
      }

      if (this.changes === 0) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      res.json({ message: 'Last played position updated successfully' });
    }
  );
});


// last played 2nd audio 
app.put('/api/exuser4/:user_id', (req, res) => {
  const { user_id } = req.params;
  const { last_played_position } = req.body;

  if (typeof last_played_position !== 'number') {
    res.status(400).json({ error: 'Invalid data type for last_played_position' });
    return;
  }

  db.run(
    'UPDATE exuser SET last_played_position2 = ? WHERE user_id = ?',
    [last_played_position, user_id],
    function(err) {
      if (err) {
        console.error(err);
        res.status(500).json({ error: 'Could not update last played position' });
        console.log('Could not update last played position')
        return;
      }

      if (this.changes === 0) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      res.json({ message: 'Last played position updated successfully' });
    }
  );
});

// fetch latest audio 
app.get('/api/exuser2/:user_id', (req, res) => {
  const { user_id } = req.params;

  db.get(
    'SELECT last_played_position FROM exuser WHERE user_id = ?',
    [user_id],
    (err, row) => {
      if (err) {
        console.error(err);
        res.status(500).json({ error: 'Could not fetch last played position' });
        return;
      }

      if (!row) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      res.json(row);
    }
  );})
// fetch countdown position 

  app.get('/api/countexuser2/:user_id', (req, res) => {
    const { user_id } = req.params;
  
    db.get(
      'SELECT countdown_position FROM exuser WHERE user_id = ?',
      [user_id],
      (err, row) => {
        if (err) {
          console.error(err);
          res.status(500).json({ error: 'Could not fetch last played position' });
          return;
        }
  
        if (!row) {
          res.status(404).json({ error: 'User not found' });
          return;
        }
  
        res.json(row);
      }
    );})
  
  // fetch countdown position 

  app.get('/api/trialexuser2/:user_id', (req, res) => {
    const { user_id } = req.params;
  
    db.get(
      'SELECT trial_position FROM exuser WHERE user_id = ?',
      [user_id],
      (err, row) => {
        if (err) {
          console.error(err);
          res.status(500).json({ error: 'Could not fetch last played position' });
          return;
        }
  
        if (!row) {
          res.status(404).json({ error: 'User not found' });
          return;
        }
  
        res.json(row);
      }
    );})

// restart second audio one where its left 
app.get('/api/exuser3/:user_id', (req, res) => {
  const { user_id } = req.params;

  db.get(
    'SELECT last_played_position2 FROM exuser WHERE user_id = ?',
    [user_id],
    (err, row) => {
      if (err) {
        console.error(err);
        res.status(500).json({ error: 'Could not fetch last played position' });
        return;
      }

      if (!row) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      res.json(row);
    }
  );})

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

  app.put('/api/trialexuser/:user_id', (req, res) => {
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
  
// update status of countdown audio 
app.put('/api/countexuser/:user_id', (req, res) => {
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



// update information date time 
app.post('/api/infolog', (req, res) => {
  const { user_id, information } = req.body;
  
  // Update the 'information' column for the given 'user_id'
  db.run('UPDATE logs SET information = ? WHERE user_id = ?', [information, user_id], function(err) {
    if (err) {
      return console.error(err.message);
    }
    console.log(`Row updated for user_id ${user_id}`);
  });
});

app.post('/api/introlog', (req, res) => {
  const { user_id, information } = req.body;
  
  // Update the 'information' column for the given 'user_id'
  db.run('UPDATE logs SET Instruction = ? WHERE user_id = ?', [information, user_id], function(err) {
    if (err) {
      return console.error(err.message);
    }
    console.log(`Row updated for user_id ${user_id}`);
  });
});

app.post('/api/testaudio', (req, res) => {
  const { user_id, information } = req.body;
  
  // Update the 'information' column for the given 'user_id'
  db.run('UPDATE logs SET testaudio = ? WHERE user_id = ?', [information, user_id], function(err) {
    if (err) {
      return console.error(err.message);
    }
    console.log(`Row updated for user_id ${user_id}`);
  });
});


// delete selected user log 
app.delete('/delete-user-data/:user_id', (req, res) => {
  const { user_id } = req.params;

  const updateQuery = `
    UPDATE logs
    SET Logging = NULL,
        information = NULL,
        Instruction = NULL,
        testaudio = NULL,
        logout = NULL,
        trial_passage=NULL,
        passage1=NULL,
        passage2=NULL
    WHERE user_id = ?
  `;

  db.run(updateQuery, [user_id], function (err) {
    if (err) {
      console.error('Error updating data:', err);
      res.status(500).json({ error: 'Internal Server Error' });
    } else {
      console.log('Update successful');
      res.status(200).json({ message: 'Update successful' });
    }
  });
});

// delete all user log 
// Define a route to handle the deletion operation for all users
app.delete('/delete-all-user-data', (req, res) => {
  const updateQuery = `
    UPDATE logs
    SET Logging = NULL,
    information = NULL,
    Instruction = NULL,
    testaudio = NULL,
    logout = NULL,
    trial_passage=NULL,
    passage1=NULL,
    passage2=NULL,
    countdown= NULL
  `;



  db.run(updateQuery, function (err) {
    if (err) {
      console.error('Error updating data:', err);
      res.status(500).json({ error: 'Internal Server Error' });
    } else {
      console.log('Update successful');
      res.status(200).json({ message: 'Update successful for all users' });
    }
  });
});

app.delete('/delete-all-user-percent', (req, res) => {
  const updateQuery = `
    UPDATE exuser
    SET last_played_position = 0,
    last_played_position2 = 0,
    countdown_position=0,
    trial_position=0,
    login = "FALSE"

  `;


    db.run(updateQuery, function (err) {
      if (err) {
        console.error('Error updating data:', err);
        res.status(500).json({ error: 'Internal Server Error' });
      } else {
        console.log('Update successful');
        res.status(200).json({ message: 'Update successful for all users' });
      }
    });
  });



app.get('/api/infolog1/:user_id', (req, res) => {
  const userId = req.params.user_id;
  const query = `SELECT * FROM logs WHERE user_id = ? AND information IS NOT NULL`;

  db.all(query, [userId], (err, rows) => {
    if (err) {
      console.error(err);
      res.status(500).json({ error: 'Internal Server Error' });
      return;
    }

    if (rows.length == 1 ) {
      console.log(rows.length)
      res.json({ data: 'yes' });
    } else {
      res.json({ data: 'no' });
    }
  });
});
 
app.get('/api/intro1/:user_id', (req, res) => {
  const userId = req.params.user_id;

  // Query the database for logs with non-null information column for the specified user_id
  const query = `SELECT * FROM logs WHERE user_id = ? AND Instruction IS NOT NULL`;
  db.all(query, [userId], (err, rows) => {
    if (err) {
      console.error(err);
      res.status(500).send('Internal Server Error');
      return;
    }

    // Check if there are logs with non-null information
    if (rows.length == 1) {
      // Send 'yes' as a JSON string
      res.json('yes');
    } else {
      // Send 'no' as a JSON string
      res.json('no');
    }
  });
});

// admin part 
app.get('/api/userlogs', (req, res) => {
  const sql = `
    SELECT exuser.trial_position, exuser.last_played_position, exuser.last_played_position2, exuser.countdown_position, logs.*
    FROM logs 
    INNER JOIN exuser 
    ON exuser.user_id =logs.user_id
  `;

  db.all(sql, [], (err, rows) => {
    if (err) {
      throw err;
    }
    res.json(rows);
  });
});


app.get('/api/testaudio1/:user_id', (req, res) => {
  const userId = req.params.user_id;

  // Query the database for logs with non-null information column for the specified user_id
  const query = `SELECT * FROM logs WHERE user_id = ? AND testaudio IS  NOT NULL`;
  db.all(query, [userId], (err, rows) => {
    if (err) {
      console.error(err);
      res.status(500).send('Internal Server Error');
      return;
    }

    // Check if there are logs matching the criteria
    if (rows.length == 1) {
      // Send 'yes' as a JSON string
      res.json('yes');
    } else {
      // Send an empty response
      res.send('');
    }
  });
});

// Token creation function using jsonwebtoken
function createToken(payload) {
  // Set expiresIn to 30 minutes
  const expiresIn = 30 * 60; // 30 minutes in seconds

  // Sign the token with the payload, secret key, and expiration time
  return jwt.sign(payload, 'your-secret-key', { expiresIn });
}



const port = 5000;

app.listen(port, '0.0.0.0', () => {
  console.log(`Server is running on port ${port}`);
});
