const fs = require('fs');
const https = require('https');
const express = require('express');
const soap = require('soap');
const router = express.Router();

const utils = require('./utils')();

// Include root CA
var ca = fs.readFileSync('./CA_Sistem_Terdistribusi_2015.crt');
https.globalAgent.options.ca = [ca];
// process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0';

module.exports = function (models) {

  router.get('/home', (req, res) => {
    utils.getQuorum((err, statuses) => {
      if (err) return res.json(err);

      const total = statuses.reduce((e, v) => e + v);

      const services = [
        '<li><a href="ping">ping</a></li>',
        '<li><a href="quorum">quorum</a></li>',
        '<li>' + (total >= 5 ? '<a href="register">register</a>' : '<del>register</del>') + '</li>',
        '<li>' + (total >= 5 ? '<a href="getSaldo">getSaldo</a>' : '<del>getSaldo</del>') + '</li>',
        '<li>' + (total >= 5 ? '<a href="transfer">transfer</a>' : '<del>transfer</del>') + '</li>',
        '<li>' + (total >= 8 ? '<a href="getTotalSaldo">getTotalSaldo</a>' : '<del>getTotalSaldo</del>') + '</li>',
      ].join('');

      res.send(`
        <!DOCTYPE html>
        <title>Kantor Cabang Bobby</title>
        <h1>Kantor Cabang Bobby - 1206208315</h1>
        <h2>Status Quorum: ${total} hidup</h2>

        <h3>Layanan</h3>
        <ul>
          ${services}
        </ul>
      `);
    });
  });

  router.get('/ping', (req, res) => {
    res.send(`
      <!DOCTYPE html>
      <title>Ping</title>
      <form method="post">
        <input type="text" name="wsdl" placeholder="WSDL Kantor Cabang Tujuan" /><br>
        <input type="submit" value="Ping" />
      </form>
    `);
  });

  router.post('/ping', (req, res) => {
    soap.createClient(req.body.wsdl, (err, client) => {
      if (err) return res.json(err);

      client.ping(null, (err, response) => {
        if (err) return res.json(err);
        res.send('Ping response from ' + req.body.wsdl + ': ' + (response.pingReturn.$value || response.pingReturn));
      });
    });
  });

  router.get('/getSaldo', (req, res) => {
    res.send(`
      <!DOCTYPE html>
      <title>Get Saldo</title>
      <form method="post">
        <input type="text" name="wsdl" placeholder="WSDL Kantor Cabang Tujuan" /><br>
        <input type="text" name="user_id" placeholder="User ID" /><br>
        <input type="submit" value="Submit" />
      </form>
    `);
  });

  router.post('/getSaldo', (req, res) => {
    soap.createClient(req.body.wsdl, (err, client) => {
      if (err) return res.json(err);

      client.getSaldo({ user_id: req.body.user_id }, (err, response) => {
        if (err) return res.json(err);
        const balance = typeof response.getSaldoReturn.$value == 'number' ?
                        response.getSaldoReturn.$value : response.getSaldoReturn;

        if (balance < 0) {
          console.log('Balance minus');
          models.User.findOne({ user_id: req.body.user_id })
            .then(userData => {
              if (!userData) {
                return res.json('Error, user id not found in client\'s database');
              } else {
                console.log('Registering user');
                client.register({
                  user_id: userData.user_id,
                  nama: userData.nama,
                  ip_domisili: userData.ip_domisili
                }, (err, response) => {
                  if (err) return res.json('Error registering user to target service');
                  return res.send('Saldo from ' + req.body.user_id + ': ' + balance);
                });
              }
            });
        } else {
          return res.send('Saldo from ' + req.body.user_id + ': ' + balance);
        }
      });
    });
  });

  router.get('/register', (req, res) => {
    res.send(`
      <!DOCTYPE html>
      <title>Register</title>
      <form method="post">
        <input type="text" name="wsdl" placeholder="WSDL Kantor Cabang Tujuan" /><br>
        <input type="text" name="user_id" placeholder="User ID" /><br>
        <input type="text" name="nama" placeholder="Nama" /><br>
        <input type="text" name="ip_domisili" placeholder="Wsdl Domisili" /><br>
        <input type="submit" value="Submit" />
      </form>
    `);
  });

  router.post('/register', (req, res) => {
    soap.createClient(req.body.wsdl, (err, client) => {
      if (err) return res.json(err);

      client.register({ user_id: req.body.user_id, nama: req.body.nama, ip_domisili: req.body.ip_domisili }, (err, response) => {
        if (err) return res.json(err);
        res.send('Register done!');
      });
    });
  });

  router.get('/transfer', (req, res) => {
    res.send(`
      <!DOCTYPE html>
      <title>Transfer</title>
      <form method="post">
        <input type="text" name="wsdl" placeholder="WSDL Kantor Cabang Tujuan" /><br>
        <input type="text" name="user_id" placeholder="User ID" /><br>
        <input type="number" name="nilai" placeholder="Nilai" /><br>
        <input type="submit" value="Submit" />
      </form>
    `);
  });

  router.post('/transfer', (req, res) => {
    models.User.findOne({ user_id: req.body.user_id })
      .then(user => {
        if (!user) {
          return res.json({ err: 'User not found' });
        }

        const nilai = Number(req.body.nilai);

        if (user.saldo < nilai) {
          return res.json({ err: 'Issufficient balance' });
        }

        const wsdl = req.body.wsdl;

        soap.createClient(wsdl, (err, client) => {
          if (err) return res.json(err);

          client.getSaldo({ user_id: req.body.user_id }, (err, response) => {
            if (err) return res.json(err);

            const balance = typeof response.getSaldoReturn.$value == 'number' ?
                        response.getSaldoReturn.$value : response.getSaldoReturn;

            if (balance < 0) {
              client.register({ user_id: user.user_id, nama: user.nama, ip_domisili: user.ip_domisili }, (err, response) => {
                if (err) return res.json(err);
                doTransfer();
              });
            } else {
              doTransfer();
            }
          });

          function doTransfer() {
            client.transfer({ user_id: user.user_id, nilai: req.body.nilai }, (err, response) => {
              if (err) return res.json(err);

              if (response.transferReturn !== 0 && response.transferReturn.$value !== 0) {
                return res.json({ err: 'Transfer failed' });
              }

              user.saldo -= nilai;
              user.save().then(() => {
                res.send('Transfer success');
              });
            });
          }
        });
      });
  });

  router.get('/getTotalSaldo', (req, res) => {
    res.send(`
      <!DOCTYPE html>
      <title>Get Total Saldo</title>
      <form method="post">
        <input type="text" name="wsdl" placeholder="WSDL Kantor Cabang Tujuan" /><br>
        <input type="text" name="user_id" placeholder="User ID" /><br>
        <input type="submit" value="Submit" />
      </form>
    `);
  });

  router.post('/getTotalSaldo', (req, res) => {
    soap.createClient(req.body.wsdl, (err, client) => {
      if (err) return res.json(err);

      client.getTotalSaldo({ user_id: req.body.user_id }, (err, response) => {
        if (err) return res.json(err);
        const balance = typeof response.getTotalSaldoReturn.$value == 'number' ?
                        response.getTotalSaldoReturn.$value : response.getTotalSaldoReturn;

        return res.send('Total Saldo from ' + req.body.user_id + ': ' + balance);
      });
    });
  });

  router.get('/quorum', (req, res) => {
    const quorum = utils.quorum.join('<br>');
    res.send(`
      <!DOCTYPE html>
      <title>Quorum</title>
      <h3>Quorum participants:</h3>
      <p>${quorum}</p>
      <form method="post">
        <input type="submit" value="Get Quorum" />
      </form>
    `);
  });

  router.post('/quorum', (req, res) => {
    utils.getQuorum((err, statuses) => {
      if (err) return res.json(err);

      const quorum = utils.quorum.map((_, i) => {
        return `${utils.quorum[i]}: ${statuses[i]}`;
      }).join('<br>');

      const total = statuses.reduce((e, v) => e + v);

      res.send(`
        <!DOCTYPE html>
        <title>Quorum</title>
        <h3>Quorum participants:</h3>
        <p>${quorum}</p>
        <form method="post">
          <input type="submit" value="Get Quorum" />
        </form>
        <p>Quorum total:  ${total}</p>
      `);
    });
  });

  return router;
};
