/*
Copyright 2019 Adobe. All rights reserved.
This file is licensed to you under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License. You may obtain a copy
of the License at http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed under
the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
OF ANY KIND, either express or implied. See the License for the specific language
governing permissions and limitations under the License.
*/

const tmp = require('tmp-promise')
const fs = require('fs-extra')
const git = require('isomorphic-git')
const openwhisk = require('openwhisk')
const path = require('path')
const archiver = require('archiver')
const npm = require('npm')

git.plugins.set('fs', fs)

require('dotenv').config()

async function clone (dir, ref) {
  console.log(`cloning ${process.env.GIT_URL}`)
  await git.clone({
    dir: dir,
    url: process.env.GIT_URL,
    username: process.env.GIT_USERNAME,
    password: process.env.GIT_PASSWORD,
    noGitSuffix: true,
    noCheckout: true
  })
  console.log(`checking out ${ref}`)
  return git.checkout({ dir: dir, ref: ref })
}

async function forEachRuntimeAction (folder, callback) {
  console.log(`Iterating through runtime-actions under ${folder}`)
  const actionsDir = path.resolve(folder, 'runtime-actions')
  console.log(actionsDir)
  if (!await fs.pathExists(actionsDir)) {
    console.log('No runtime-actions found')
    return []
  }
  const actions = await fs.readdir(actionsDir)
  const missingActions = []
  for (const action of actions) {
    const actionDir = path.resolve(actionsDir, action)
    console.log(`Building and deploying ${actionDir}`)
    if (!await callback(action, actionDir)) {
      missingActions.push(action)
    }
  }
  return missingActions
}

function build (dir) {
  return new Promise((resolve, reject) => {
    npm.load({
      loaded: false
    }, function (err) {
      if (err) {
        reject(err)
      }
      npm.prefix = dir
      console.log(`running npm install in ${dir}`)
      npm.commands.install(dir, [], function (err, data) {
        if (err) {
          reject(err)
        } else {
          console.log(`running npm run build in ${dir}`)
          npm.commands.run(['build'], function (err, data) {
            if (err) {
              reject(err)
            } else {
              resolve()
            }
          })
        }
      })

      npm.on('log', function (message) {
        console.log(message)
      })
    })
  })
}

async function createZip (name, dir) {
  const { path: zipOutputPath } = await tmp.file({
    unsafeCleanup: true
  })
  console.log(`creating ${zipOutputPath}`)
  const output = fs.createWriteStream(zipOutputPath)
  const archive = archiver('zip', {
    zlib: { level: 9 }
  })
  archive.pipe(output)

  return new Promise((resolve, reject) => {
    archive.on('error', function (err) {
      reject(err)
    })
    output.on('close', function () {
      resolve(zipOutputPath)
    })

    archive.directory(dir, false)

    archive.finalize()
  })
}

async function buildAndDeploy (name, version, actionDir, ow, actionNames) {
  const actionName = `${name}-${version}`
  await build(actionDir)
  const zipArchive = await createZip(name, actionDir)
  console.log(zipArchive)
  const action = fs.readFileSync(zipArchive)

  const actionSpec = {
    name: actionName,
    action: action,
    annotations: {
      'web-export': true
    }
  }

  return new Promise((resolve, reject) => {
    if (actionNames.indexOf(name) >= 0) {
      ow.actions.update(actionSpec).then(result => {
        const message = `action (${actionName}) updated!`
        console.log(message)
        resolve({ message: message })
      }).catch(err => {
        console.log('failed to update action', err)
        reject(err)
      })
    } else {
      ow.actions.create(actionSpec).then(result => {
        const message = `action (${actionName}) created!`
        console.log(message)
        resolve({ message: message })
      }).catch(err => {
        console.log('failed to create action', err)
        reject(err)
      })
    }
  })
}

async function asyncMain (ref, version, check) {
  const ow = openwhisk()

  const { path: tmpDirectory } = await tmp.dir({
    unsafeCleanup: true
  })

  console.log(tmpDirectory)

  console.log(`cloning into ${tmpDirectory}`)

  await clone(tmpDirectory, ref)
  console.log('cloned')
  fs.readdirSync(tmpDirectory).forEach(file => {
    console.log(file)
  })

  const actions = await ow.actions.list()
  const actionNames = actions.map(a => a.name)

  if (check) {
    const missingActions = await forEachRuntimeAction(tmpDirectory, async (name) => actionNames.indexOf(`${name}-${version}`) > -1)
    return {
      result: missingActions.length === 0,
      missingActions: missingActions.map(name => `${name}-${version}`)
    }
  } else {
    const actions = forEachRuntimeAction(tmpDirectory, async (name, actionDir) => buildAndDeploy(name, version, actionDir, ow, actionNames))
    return {
      result: actions
    }
  }
}

function main (params) {
  return new Promise((resolve, reject) => {
    asyncMain(params.ref, params.version, params.check).then(resolve).catch(reject)
  })
}

exports.main = main
