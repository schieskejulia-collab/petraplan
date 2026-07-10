import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Test-Route, um zu sehen, ob die API lebt
app.get('/', (req, res) => {
  res.json({ status: 'Mila API läuft einwandfrei!' });
});

// Hier kommen deine Routen hin (z. B. app.use('/api', ...))

// Server starten
app.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`);
});
