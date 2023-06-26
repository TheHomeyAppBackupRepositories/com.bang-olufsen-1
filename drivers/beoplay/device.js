'use strict';

const Homey = require('homey');

const BeoNetRemoteClient = require('../../lib/BeoNetRemoteClient');

class BeoplayDevice extends Homey.Device {

  async onInit() {
    this._onDeviceTrack = this._onDeviceTrack.bind(this);
    this._onDeviceState = this._onDeviceState.bind(this);
    this._onDeviceVolume = this._onDeviceVolume.bind(this);
    this._onDeviceAvailable = this._onDeviceAvailable.bind(this);
    this._onDeviceUnavailable = this._onDeviceUnavailable.bind(this);

    this.id = this.getData().id;

    this.registerCapabilityListener('speaker_playing', this._onCapabilitySpeakerPlaying.bind(this));
    this.registerCapabilityListener('speaker_prev', this._onCapabilitySpeakerPrev.bind(this));
    this.registerCapabilityListener('speaker_next', this._onCapabilitySpeakerNext.bind(this));
    this.registerCapabilityListener('volume_set', this._onCapabilitySpeakerVolumeSet.bind(this));

    this.image = await this.homey.images.createImage();
    // this.image.setUrl(null);
    this.setAlbumArtImage(this.image)
      .catch(this.error);

    this.sources = [];
  }

  onDeleted() {
    if (this.client) {
      this.client.off('track', this._onDeviceTrack);
      this.client.off('state', this._onDeviceState);
      this.client.off('volume', this._onDeviceVolume);
      this.client.off('available', this._onDeviceAvailable);
      this.client.off('unavailable', this._onDeviceUnavailable);

      this.client.disconnect();
    }

    if (this.image) {
      this.image.unregister();
    }
  }

  async onDiscoveryAvailable(discoveryResult) {
    this.client = new BeoNetRemoteClient({
      homey: this.homey,
      address: discoveryResult.address,
    });
    await this.client.connect();

    this.client.on('track', this._onDeviceTrack);
    this.client.on('state', this._onDeviceState);
    this.client.on('volume', this._onDeviceVolume);
    this.client.on('available', this._onDeviceAvailable);
    this.client.on('unavailable', this._onDeviceUnavailable);

    this.client.getSources()
      .then(data => {
        this._setSources(data.sources);
      })
      .catch(this.error);
  }

  onDiscoveryResult(discoveryResult) {
    if (!discoveryResult.txt) return false;
    if (!discoveryResult.txt.mac) return false;
    return discoveryResult.txt.mac.startsWith(this.id);
  }

  onDiscoveryAddressChanged(discoveryResult) {
    if (this.client) {
      this.client.setAddress(discoveryResult.address);
    }
  }

  /**
   * Creates a list of sources available
   *
   * @param sources
   * @private
   */
  _setSources(sources) {
    if (sources && sources.length > 0) {
      this.sources = [];

      sources.forEach(source => {
        if (source[1]
          && source[1].hasOwnProperty('friendlyName')
          && source[1].hasOwnProperty('sourceType')
          && source[1].sourceType.hasOwnProperty('type')
        ) {
          this.sources.push({
            name: source[1].friendlyName,
            id: source[1].sourceType.type,
          });
        }
      });
    }
  }

  /**
   * Returns a list of available sources
   *
   * @returns {[]}
   */
  getSources() {
    return this.sources;
  }

  _onDeviceTrack(track) {
    this.track = track;

    this.setCapabilityValue('speaker_track', this.track.name || '-').catch(this.error);
    this.setCapabilityValue('speaker_album', this.track.album || '-').catch(this.error);
    this.setCapabilityValue('speaker_artist', this.track.artist || '-').catch(this.error);
    this.setCapabilityValue('speaker_duration', this.track.duration || 0).catch(this.error);
    this.setCapabilityValue('speaker_position', this.track.position || 0).catch(this.error);

    let url;
    if (track.image) {
      url = track.image.replace('http://', 'https://');
    } else {
      url = null;
    }

    if (this.image) {
      this.image.setUrl(url);
      this.image.update().catch(this.error);
    }
  }

  _onDeviceVolume({ volume }) {
    this.setCapabilityValue('volume_set', volume).catch(this.error);
  }

  _onDeviceState({ playing, position }) {
    this.setCapabilityValue('speaker_position', position || 0).catch(this.error);
    this.setCapabilityValue('speaker_playing', !!playing).catch(this.error);
  }

  _onDeviceAvailable() {
    this.setAvailable().catch(this.error);
  }

  _onDeviceUnavailable() {
    this.setUnavailable(this.homey.__('unavailable')).catch(this.error);
  }

  async _onCapabilitySpeakerPlaying(playing) {
    if (playing) {
      return this.client.play();
    }

    return this.client.pause();
  }

  async _onCapabilitySpeakerPrev() {
    return this.client.prev();
  }

  async _onCapabilitySpeakerNext() {
    return this.client.next();
  }

  async _onCapabilitySpeakerVolumeSet(volume) {
    return this.client.setVolume({ volume });
  }

  /**
   * Sets the active play source From a Flow
   *
   * @param source
   * @returns {Promise<*>}
   */
  async setActiveSource(source) {
    return this.client.setActiveSource({ id: source.id });
  }

}

module.exports = BeoplayDevice;
