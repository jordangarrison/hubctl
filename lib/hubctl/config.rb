require 'yaml'

module Hubctl
  class Config
    CONFIG_FILE = File.expand_path('~/.hubctl.yml')

    def self.load
      return {} unless File.exist?(CONFIG_FILE)

      YAML.load_file(CONFIG_FILE) || {}
    rescue => e
      warn "Warning: Failed to load config file: #{e.message}"
      {}
    end

    def self.save(config)
      File.write(CONFIG_FILE, YAML.dump(config))
    end

    def self.get(key)
      load[key.to_s]
    end

    def self.set(key, value)
      config = load
      config[key.to_s] = value
      save(config)
    end

    def self.example_config
      {
        'github_token' => 'your_github_token_here',
        'default_org' => 'your-organization',
        'server' => {
          'port' => 3000,
          'host' => '0.0.0.0'
        }
      }
    end
  end
end
