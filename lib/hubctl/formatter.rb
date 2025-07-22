require 'json'
require 'tty-table'
require 'pastel'

module Hubctl
  class Formatter
    def initialize(format: :table, color: true)
      @format = format.to_sym
      @color = color
      @pastel = Pastel.new(enabled: @color)
    end

    def output(data, headers: nil)
      case @format
      when :json
        puts JSON.pretty_generate(data)
      when :table
        output_table(data, headers)
      when :list
        output_list(data)
      else
        puts data.inspect
      end
    end

    def success(message)
      output_stream.puts @pastel.green("✓ #{message}")
    end

    def error(message)
      output_stream.puts @pastel.red("✗ #{message}")
    end

    def warning(message)
      output_stream.puts @pastel.yellow("⚠ #{message}")
    end

    def info(message)
      output_stream.puts @pastel.blue("ℹ #{message}")
    end

    def bold(text)
      @pastel.bold(text)
    end

    def dim(text)
      @pastel.dim(text)
    end

    private

    def output_stream
      # When outputting structured formats (JSON/list), send log messages to stderr to keep stdout clean
      [:json, :list].include?(@format) ? $stderr : $stdout
    end

    def output_table(data, headers)
      return puts @pastel.dim("No data to display") if data.empty?

      # Handle array of hashes
      if data.is_a?(Array) && data.first.is_a?(Hash)
        headers ||= data.first.keys.map(&:to_s)
        rows = data.map { |item| headers.map { |h| format_cell_value(item[h.to_sym] || item[h]) } }
      # Handle single hash
      elsif data.is_a?(Hash)
        headers ||= ['Key', 'Value']
        rows = data.map { |k, v| [k.to_s, format_cell_value(v)] }
      # Handle array of arrays
      elsif data.is_a?(Array) && data.first.is_a?(Array)
        rows = data.map { |row| row.map { |cell| format_cell_value(cell) } }
      else
        # Fallback for other data types
        puts data.inspect
        return
      end

      table = TTY::Table.new(headers, rows)
      puts table.render(:ascii, padding: [0, 1])
    end

    def output_list(data)
      return puts @pastel.dim("No data to display") if data.empty?

      if data.is_a?(Array)
        data.each do |item|
          puts format_list_item(item)
        end
      else
        puts format_list_item(data)
      end
    end

    def format_cell_value(value)
      case value
      when true
        @pastel.green('✓')
      when false
        @pastel.red('✗')
      when nil
        @pastel.dim('-')
      when Time, DateTime
        value.strftime('%Y-%m-%d %H:%M')
      else
        truncate_text(value.to_s, 50)
      end
    end

    def format_list_item(item)
      case item
      when Hash
        # Output as tab-separated values for easy parsing with awk
        # Format: value1<tab>value2<tab>value3...
        item.values.map { |v| format_list_value(v) }.join("\t")
      else
        item.to_s
      end
    end

    def format_list_value(value)
      case value
      when true
        'true'
      when false
        'false'
      when nil
        '-'
      when Time, DateTime
        value.strftime('%Y-%m-%d %H:%M')
      else
        # Remove newlines and tabs that would break TSV format
        value.to_s.gsub(/[\n\r\t]/, ' ').strip
      end
    end

    def truncate_text(text, length)
      text.length > length ? "#{text[0...length-3]}..." : text
    end
  end
end
