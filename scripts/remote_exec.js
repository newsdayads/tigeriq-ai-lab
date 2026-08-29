const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const Ajv = require('ajv');
const ajv = new Ajv();
const commandSchema = require('./schemas/command_schema_v1.json');

const validateCommand = ajv.compile(commandSchema);

const executeCommand = (command) => {
  if (!validateCommand(command)) {
    console.error('Invalid command schema:', validateCommand.errors);
    return;
  }

  switch (command.action) {
    case 'read':
      fs.readFile(command.path, 'utf8', (err, data) => {
        if (err) {
          console.error('Error reading file:', err);
        } else {
          console.log('File content:', data);
        }
      });
      break;
    case 'list':
      fs.readdir(command.path, (err, files) => {
        if (err) {
          console.error('Error listing directory:', err);
        } else {
          console.log('Directory contents:', files);
        }
      });
      break;
    case 'write':
      fs.writeFile(command.path, command.content, (err) => {
        if (err) {
          console.error('Error writing file:', err);
        } else {
          console.log('File written successfully');
        }
      });
      break;
    case 'run':
      exec(command.argv.join(' '), { timeout: command.timeout * 1000 }, (err, stdout, stderr) => {
        if (err) {
          console.error('Command execution error:', err);
        } else {
          console.log('Command stdout:', stdout);
          console.error('Command stderr:', stderr);
        }
      });
      break;
    case 'finish':
      console.log('Execution finished:', command.summary);
      break;
    default:
      console.error('Unsupported action:', command.action);
  }
};

// Example usage
const command = {
  action: 'read',
  path: 'F:\\TigerIQ\\Workspace\\tigeriq-ai-lab\\README.md'
};

executeCommand(command);