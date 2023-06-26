'use strict';

const { EventEmitter } = require('events');
const fetch = require('node-fetch');

const VOLUME_MIN = 1;
const VOLUME_MAX = 89;
const KEEP_ALIVE_INTERVAL = 5000;
const NOTIFY_DELIMITER = '\r\n\r\n';

class BeoNetRemoteClient extends EventEmitter {

  constructor({ homey, address, port = 8080 }) {
    super();

    this.homey = homey;
    this.address = address;
    this.port = port;

    this.keepAlive = this.keepAlive.bind(this);
    this.alive = false;
  }

  setAddress(address) {
    this.address = address;
  }

  async connect() {
    if (this._notifyStream) {
      throw new Error('already_connected');
    }

    if (this.keepAliveInterval) {
      this.homey.clearInterval(this.keepAliveInterval);
    }
    this.keepAliveInterval = this.homey.setInterval(this.keepAlive, KEEP_ALIVE_INTERVAL);

    const res = await fetch(`http://${this.address}:${this.port}/BeoNotify/Notifications`, {
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.alive = true;

    let buf = '';
    this._notifyStream = res.body;
    this._notifyStream.on('data', data => {
      buf += data.toString();

      while (buf.indexOf(NOTIFY_DELIMITER) !== -1) {
        const index = buf.indexOf(NOTIFY_DELIMITER);
        const slice = buf.slice(0, index);
        buf = buf.slice(index + NOTIFY_DELIMITER.length);

        if (slice && slice.length) {
          try {
            const { notification } = JSON.parse(slice);
            this._onNotification(notification);
          } catch (err) {
            this.error(err, slice.toString());
          }
        }
      }
    });
  }

  async disconnect() {
    if (this._notifyStream) {
      this._notifyStream.end();
      this._notifyStream = null;
    }

    if (this.keepAliveInterval) {
      this.homey.clearInterval(this.keepAliveInterval);
    }
  }

  _onNotification({
    timestamp,
    type,
    kind,
    data,
  }) {
    if (kind === 'renderer') {
      if (type === 'VOLUME') {
        const volume = this.constructor.volumeBeoplayToPercentage(data.speaker.level);
        this.emit('volume', { volume });
      }
    } else if (kind === 'playing') {
      if (type === 'NOW_PLAYING_STORED_MUSIC') {
        let image = null;
        if (data.trackImage && data.trackImage.length) {
          image = data.trackImage[0].url;
        } else if (data.albumImage && data.albumImage.length) {
          image = data.albumImage[0].url;
        }

        this.emit('track', {
          image,
          name: data.name || null,
          artist: data.artist || null,
          album: data.album || null,
          id: data.playQueueItemId || null,
          duration: data.duration || null,
        });
      } else if (type === 'PROGRESS_INFORMATION') {
        this.emit('state', {
          position: data.position,
          playing: data.state === 'play',
        });
      }
    }
  }

  keepAlive() {
    if (!this._notifyStream) {
      return;
    }

    this.ping().then(async () => {
      if (!this.alive) {
        await this.disconnect();
        await this.connect();
        this.emit('available');
      }
    }).catch(err => {
      this.alive = false;
      this.emit('unavailable');
    });
  }

  async _call({
    method = 'GET', path, body, timeout = 0,
  }) {
    return fetch(`http://${this.address}:${this.port}${path}`, {
      method,
      timeout,
      body: JSON.stringify(body),
      headers: {
        'Content-Type': 'application/json',
      },
    }).then(res => {
      if (!res.ok) {
        throw new Error(`${res.status} ${res.statusText}`);
      }

      if (res.headers.get('Content-Type') === 'application/json') {
        return res.json();
      }
    });
  }

  async ping() {
    return this._call({
      method: 'GET',
      path: '/BeoZone/Zone',
      timeout: KEEP_ALIVE_INTERVAL / 1.5,
    });
  }

  async getVolume() {
    return this._call({
      method: 'GET',
      path: '/BeoZone/Zone/Sound/Volume/Speaker/Level',
    }).then(({ level }) => {
      return this.constructor.volumeBeoplayToPercentage(level);
    });
  }

  async setVolume({ volume }) {
    const level = this.constructor.volumePercentageToBeoplay(volume);
    return this._call({
      method: 'PUT',
      path: '/BeoZone/Zone/Sound/Volume/Speaker/Level',
      body: { level },
    });
  }

  async getMuted() {
    return this._call({
      method: 'GET',
      path: '/BeoZone/Zone/Sound/Volume/Speaker/Muted',
    }).then(({ muted }) => muted);
  }

  async setMuted({ muted }) {
    return this._call({
      method: 'PUT',
      path: '/BeoZone/Zone/Sound/Volume/Speaker/Muted',
      body: { muted },
    });
  }

  async getPosition() {
    return this._call({
      method: 'GET',
      path: '/BeoZone/Zone/PlayQueue/PlayPointer',
    });
  }

  async setPosition({ position = 0 }) {
    return this._call({
      method: 'POST',
      path: '/BeoZone/Zone/PlayQueue/PlayPointer',
      body: {
        playPointer: {
          position,
        },
      },
    });
  }

  async play() {
    return this._call({
      method: 'POST',
      path: '/BeoZone/Zone/Stream/Play',
    });
  }

  async pause() {
    return this._call({
      method: 'POST',
      path: '/BeoZone/Zone/Stream/Pause',
    });
  }

  async prev() {
    return this._call({
      method: 'POST',
      path: '/BeoZone/Zone/Stream/Backward',
    });
  }

  async next() {
    return this._call({
      method: 'POST',
      path: '/BeoZone/Zone/Stream/Forward',
    });
  }

  async getSources() {
    return this._call({
      method: 'GET',
      path: '/BeoZone/Zone/Sources',
    });
  }

  /**
   * Set the active source
   *
   * @param id
   * @returns {Promise<*>}
   */
  async setActiveSource({ id }) {
    return this._call({
      method: 'POST',
      path: '/BeoZone/Zone/ActiveSourceType',
      body: {
        sourceType: {
          type: id,
        },
      },
    });
  }

  static volumeBeoplayToPercentage(level) {
    level = Math.max(level, VOLUME_MIN);
    level = Math.min(level, VOLUME_MAX);
    return (level - VOLUME_MIN) / (VOLUME_MAX - VOLUME_MIN);
  }

  static volumePercentageToBeoplay(percentage) {
    return Math.ceil(VOLUME_MIN + percentage * (VOLUME_MAX - VOLUME_MIN));
  }

}

module.exports = BeoNetRemoteClient;
