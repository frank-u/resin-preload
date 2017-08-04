const _ = require('lodash')
const Promise = require('bluebird')
const preload = require('./preload')

const LATEST = 'latest'

function cmp (a, b) {
  if (a < b) {
    return -1
  } else if (a === b) {
    return 0
  } else {
    return 1
  }
}

function selectApplication (resin, form, deviceType) {
  // TODO: what if there is no matching app ?
  return resin.models.application.getAll({filter: {device_type: deviceType}})
  .then(function (applications) {
    return form.ask({
      message: 'Select an application',
      type: 'list',
      choices: applications.map(function (app) {
        return {name: app.app_name, value: app}
      })
    })
  })
}

function selectApplicationCommit (resin, form, appId) {
  return resin.models.build.getAllByApplication(appId)
  .then(function (builds) {
    if (builds.length === 0) {
      throw new Error('This application has no builds')
    }
    builds = builds.filter(function (build) {
      return build.status === 'success'
    }).sort(function (a, b) {
      return -cmp(a.push_timestamp, b.push_timestamp)
    })
    const choices = builds.map(function (build) {
      return {
        name: build.push_timestamp + ' - ' + build.commit_hash,
        value: build.commit_hash
      }
    })
    choices.splice(0, 0, {'name': LATEST, 'value': LATEST})
    return form.ask({
      message: 'Select a build',
      type: 'list',
      default: LATEST,
      choices: choices
    })
  })
}

function disableAutomaticUpdates (form, resin, application, commit) {
  if ((commit === LATEST) || !application.should_track_latest_release) {
    return Promise.resolve()
  }
  const message = (
    '\n' + // Multi-line messages look beter if they start after the "?"
    'This application is set to automatically update all devices to the latest\n' +
    'available version.\n' +
    'You need to disable this if you want to preload a specific build.\n' +
    'Do you want to disable automatic updates for this application?'
  )
  return form.ask({
    message: message,
    type: 'confirm',
  })
  .then(function (update) {
    if (!update) {
      return
    }
    return resin.pine.patch({
      resource: 'application',
      id: application.id,
      body: {
        should_track_latest_release: false
      }
    })
  })
}

module.exports = {
  signature: 'preload <image>',
  description: '(beta) preload an app on a disk image',
  help: `Warning: 'resin preload' requires Docker to be correctly installed in
your shell environment. For more information (including Windows support)
please check the README here: https://github.com/resin-io/resin-cli .

Use this command to preload an application to a local disk image.

Examples:
  $ resin preload resin.img --app 12345 --commit e1f2592fc6ee949e68756d4f4a48e49bff8d72a0 --splash-image some-image.png
  $ resin preload resin.img`,
  permission: 'user',
  primary: true,
  options: [
    {
      signature: 'app',
      parameter: 'appId',
      description: 'id of the application to preload',
      alias: 'a'
    },
    {
      signature: 'commit',
      parameter: 'hash',
      description: 'a specific application commit to preload (ignored if no appId is given)',
      alias: 'c'
    },
    {
      signature: 'splash-image',
      parameter: 'splashImage.png',
      description: 'path to a png image to replace the splash screen',
      alias: 's'
    },
    {
      signature: 'dont-detect-flasher-type-images',
      boolean: true,
      description: 'Disables the flasher type images detection: treats all images as non flasher types'
    }
  ],
  action: function (params, options, done) {
    console.log(options)
    const resin = require('resin-sdk-preconfigured')
    const form = require('resin-cli-form')

    options.image = params.image
    options.appId = options.app
    delete options.app

    options.dontDetectFlasherTypeImages = options['dont-detect-flasher-type-images']
    delete options['dont-detect-flasher-type-images']

    return preload.build()
    .then(resin.settings.getAll)
    .then((settings) => {
      console.log(settings)
      options.proxy = settings.proxy  // TODO: use it (set HTTP(S)_PROXY docker env var
      options.apiHost = settings.apiUrl  // TODO  'https://api.resin.io' -> 'api.resin.io'
      options.registryHost = settings.registryUrl  // TODO 'registry.resin.io' -> 'registry2.resin.io' ?
      return preload.getDeviceTypeSlug(options)
    })
    .then((deviceType) => {
      return Promise.try(() => {
        if (options.appId) {
          return resin.models.application.get(options.appId)
        }
        return selectApplication(resin, form, deviceType)
      })
      .then((application) => {
        options.appId = application.id
        if (deviceType !== application.device_type) {
          throw new Error(`Image device type (${application.device_type}) and application device type (${deviceType}) do not match`)
        }
        return resin.models.build.getAllByApplication(application.id)
        .then((builds) => {
          if (options.commit) {
            if (_.map(builds, 'commit_hash').indexOf(options.commit) === -1) {
              throw new Error('There is no build matching this commit')
            }
            return options.commit
          }
          return selectApplicationCommit(resin, form, application.id)
        })
        .then((commit) => {
          if (commit !== LATEST) {
            options.commit = commit
          }
          return disableAutomaticUpdates(form, resin, application, commit)
        })
        .then(resin.auth.getToken)
        .then((token) => {
          options.apiToken = token
          return preload.run(options)
        })
      })
    })
    .then(done)
  }
}
