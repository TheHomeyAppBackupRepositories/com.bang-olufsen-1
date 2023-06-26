'use strict';

const Homey = require('homey');

class BeoplayDriver extends Homey.Driver {

  async onInit() {
    this.homey.flow.getActionCard('beoplay_select_source')
      .registerArgumentAutocompleteListener(
        'source',
        async (query, args) => {
          return args.device.getSources();
        },
      )
      .registerRunListener(async (args, state) => {
        await args.device.setActiveSource(args.source);
      });
  }

  async onPairListDevices() {
    const discoveryStrategy = this.getDiscoveryStrategy();
    const discoveryResults = discoveryStrategy.getDiscoveryResults();

    return Object.values(discoveryResults)
      .filter(discoveryResult => {
        return !!discoveryResult.txt.mac;
      })
      .map(discoveryResult => {
        const id = discoveryResult.txt.mac.split(':')[0];
        return {
          name: discoveryResult.txt.name,
          data: { id },
        };
      });
  }

}

module.exports = BeoplayDriver;
